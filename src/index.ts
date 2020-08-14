import fastify, { WebsocketHandler } from "fastify";
import fastifyWebsocket from "fastify-websocket";
import fastifyCors from "fastify-cors";
import lnService from "ln-service";
import crypto from "crypto";
import bech32 from "bech32";

import lnd from "./setup-ln-service.js";
import db from "./db.js";

const HOST = process.env.HOST ?? "http://127.0.0.1:8080";
console.log(HOST);

const server = fastify();
server.register(fastifyWebsocket, {});
server.register(fastifyCors);

const responseMetadata = JSON.stringify([["text/plain", "Comment on lnurl-pay chat 📝"]]);

const messagesFromDb = await db.all("SELECT text FROM message ORDER BY id ASC LIMIT 1000");
const messages = messagesFromDb.map(({ text }) => text);
const socketUsers: Set<fastifyWebsocket.SocketStream> = new Set();

server.get("/api/get-bech32", async function () {
  return bech32.encode("lnurl", bech32.toWords(new Buffer(`${HOST}/api/send-text`)), 1024);
});

server.get("/api/ws", { websocket: true }, (connection, req) => {
  console.log("WebSocket connection opened");

  socketUsers.add(connection);
  connection.socket.on("message", () => {
    connection.socket.send("Hi from server");
  });
  connection.socket.on("close", () => {
    socketUsers.delete(connection);
    console.log("WebSocket connection closed");
  });

  sendToAllWebSocketConnections(
    JSON.stringify({
      type: "NUM_USERS",
      data: socketUsers.size,
    } as IWebSocketResponseNumUsers)
  );
});

interface ISendTextCallbackQueryParams {
  amount?: string;
  nonce?: string;
  fromnodes?: string;
  comment?: string;
}

interface ILNUrlAuthParams {
  amount: number;
  comment: string;
}

server.get("/api/send-text", async () => {
  return {
    tag: "payRequest",
    callback: `${HOST}/api/send-text/callback`,
    maxSendable: 10000,
    minSendable: 10000,
    metadata: responseMetadata,
    commentAllowed: 144,
  };
});

server.get("/api/send-text/callback", async (request, response) => {
  const query = request.query;
  if (!validateSendTextCallbackQueryParams(query)) {
    throw new Error("Invalid request. Missing params");
  }
  const { amount, comment } = parseSendTextCallbackQueryParams(query);

  if (!comment) {
    console.error("Got missing comment");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "You must provide a comment",
    });
    return;
  } else if (comment.length > 144) {
    console.error("Got invalid comment length");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "Comment cannot be larger than 144 letters.",
    });
    return;
  }

  const invoice = await lnService.createInvoice({
    lnd,
    tokens: amount / 1000,
    description: "Comment on lnurl-pay chat 📝",
    description_hash: crypto.createHash("sha256").update(responseMetadata).digest(),
  });

  response.send({
    pr: invoice.request,
    successAction: null,
    disposable: true,
  });

  const sub = await lnService.subscribeToInvoice({
    lnd,
    id: invoice.id,
  });

  sub.on("invoice_updated", (invoice: any) => {
    if (invoice.is_confirmed) {
      console.log(`${invoice.request.substring(0, 50)}... is confirmed!`);
      db.run(
        `INSERT INTO message
        (text)
        VALUES
        ($text)`,
        { $text: comment }
      );
      messages.push(comment);
      sendToAllWebSocketConnections(
        JSON.stringify({
          type: "MESSAGE",
          data: comment,
        } as IWebSocketResponseComment)
      );
    }
  });
});

function validateSendTextCallbackQueryParams(params: any): params is ISendTextCallbackQueryParams {
  if (!params || params.amount !== "string" || params.comment !== "string") {
    return true;
  }
  return false;
}

function parseSendTextCallbackQueryParams(params: ISendTextCallbackQueryParams): ILNUrlAuthParams {
  try {
    return {
      amount: Number.parseInt(params.amount ?? "0", 10),
      comment: params.comment ?? "",
    };
  } catch (e) {
    console.error(e);
    throw new Error("Could not parse query params");
  }
}

function sendToAllWebSocketConnections(text: string) {
  socketUsers.forEach((socket) => {
    socket.socket.send(text);
  });
}

interface IWebSocketResponse {
  type: string;
}

interface IWebSocketResponseComment extends IWebSocketResponse {
  type: "MESSAGE";
  data: string;
}

interface IWebSocketResponseNumUsers extends IWebSocketResponse {
  type: "NUM_USERS";
  data: string | number | null;
}

server.get("/api/messages", async () => {
  return {
    messages,
  };
});

server.listen(8080, "0.0.0.0", (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});

export {};
