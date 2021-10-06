import fastify from "fastify";
import fastifyCors from "fastify-cors";
import fastifyWebsocket, { SocketStream } from "fastify-websocket";
import lnService from "ln-service";
import crypto from "crypto";
import bech32 from "bech32";

import { config } from "./config.js";
import lnd from "./setup-ln-service.js";
import db from "./db.js";

const server = fastify({
  ignoreTrailingSlash: true,
});
server.register(fastifyWebsocket, {});
server.register(fastifyCors);

const responseMetadata = JSON.stringify([
  ["text/plain", "lnurl-pay chat:  Comment 📝"],
  ["text/long-desc", "Write a message to be displayed on chat.blixtwallet.com.\n\nOnce the payment goes through, your message will be displayed on the web page."],
]);

const payerData = {
  name: { mandatory: false },
};

interface IMessage {
  text: string;
  timestamp: number;
}

const messages: IMessage[] = await db.all("SELECT text, timestamp FROM message ORDER BY id ASC LIMIT 1000");
const socketUsers: Set<SocketStream> = new Set();

server.get("/api/get-bech32", async function () {
  return bech32.encode("lnurl", bech32.toWords(new Buffer(`${config.url}/api/send-text`)), 1024);
});

server.get("/api/ws", { websocket: true }, (connection, req) => {
  console.log("WebSocket connection opened");

  socketUsers.add(connection);
  connection.socket.on("message", () => {
    connection.socket.send("Hi from server");
  });
  connection.socket.on("close", () => {
    socketUsers.delete(connection);
    sendToAllWebSocketConnections(
      JSON.stringify({
        type: "NUM_USERS",
        data: socketUsers.size,
      } as IWebSocketResponseNumUsers)
    );
    console.log("WebSocket connection closed");
  });

  sendToAllWebSocketConnections(
    JSON.stringify({
      type: "NUM_USERS",
      data: socketUsers.size,
    } as IWebSocketResponseNumUsers)
  );
});

export interface IPayerData {
  name?: {
    mandatory: boolean;
  };
  pubkey?: {
    mandatory: boolean;
  };
  identifier?: {
    mandatory: boolean;
  };
  email?: {
    mandatory: boolean;
  };
  auth?: {
    mandatory?: boolean;
    k1?: string; // hex
  };
};

export interface IPayerDataResponse {
  name?: string;
  pubkey?: string; // hex
  auth?: {
    key: string;
    k1: string;
    sig: string; // hex
  },
  email?: string;
  identifier?: string;
}

interface ISendTextCallbackQueryParams {
  amount?: string;
  nonce?: string;
  fromnodes?: string;
  comment?: string;
}

interface ILNUrlPayParams {
  amount?: number;
  comment?: string;
  payerdata?: IPayerDataResponse;
}

server.get("/api/send-text", async () => {
  return {
    tag: "payRequest",
    callback: `${config.url}/api/send-text/callback`,
    maxSendable: 10000,
    minSendable: 10000,
    metadata: responseMetadata,
    commentAllowed: 144,
    payerData,
  };
});

server.get("/api/send-text/callback", async (request, response) => {
  const query = request.query;
  const { amount, comment, payerdata } = parseSendTextCallbackQueryParams(query);

  if (!amount || amount < 10 || Number.isNaN(amount)) {
    console.error("Got wrong amount");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "You must provide an amount and it must be higher than or equal to 10 sats.",
    });
    return;
  }
  if (!comment) {
    console.error("Got missing comment");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "You must provide a comment.",
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

  let dataToHash = responseMetadata;
  if (payerdata?.name) {
    dataToHash += (query as any).payerdata;
  }

  const invoice = await lnService.createInvoice({
    lnd,
    tokens: amount / 1000,
    description_hash: crypto.createHash("sha256").update(dataToHash).digest(),
  });

  response.send({
    pr: invoice.request,
    successAction: null,
    disposable: false,
  });

  const sub = await lnService.subscribeToInvoice({
    lnd,
    id: invoice.id,
  });

  sub.on("invoice_updated", (invoice: any) => {
    const nameDescedComment = payerdata?.name ? (payerdata.name + ":  " + comment) : comment;
    const timestamp = new Date().getTime();

    if (invoice.is_confirmed) {
      console.log(`${invoice.request.substring(0, 50)}... is confirmed!`);
      db.run(
        `INSERT INTO message
        (text, timestamp)
        VALUES
        ($text, $timestamp)`,
        {
          $text: nameDescedComment,
          $timestamp: timestamp,
        }
      );
      messages.push({
        text: nameDescedComment,
        timestamp,
      });
      sendToAllWebSocketConnections(
        JSON.stringify({
          type: "MESSAGE",
          data: JSON.stringify({
            text: nameDescedComment,
            timestamp,
          }),
        } as IWebSocketResponseComment)
      );
    }
  });
});

function validateSendTextCallbackQueryParams(params: any): params is ISendTextCallbackQueryParams {
  if (!params || typeof params.amount !== "string" || typeof params.comment !== "string") {
    return false;
  }
  return true;
}

function parseSendTextCallbackQueryParams(params: any): ILNUrlPayParams {
  try {
    return {
      amount: params.amount ? Number.parseInt(params.amount, 10) : undefined,
      comment: params.comment ?? undefined,
      payerdata: params.payerdata ? JSON.parse(params.payerdata) : undefined,
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

const ip = config.host.split(":")[0];
const port = config.host.split(":")[1];

server.listen(port, ip, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});

export {};
