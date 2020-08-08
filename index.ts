import fastify from "fastify";
import lnService from "ln-service";
import crypto from "crypto";
import bech32 from "bech32";
import { once, on } from "events";

import lnd from "./setup-ln-service.js";
import db from "./db.js";

const HOST = process.env.HOST ?? "http://127.0.0.1:8080";
console.log(HOST);
const server = fastify();

const responseMetadata = JSON.stringify([["text/plain", "Write a message"]]);

const messagesFromDb = await db.all("SELECT text FROM message ORDER BY id ASC LIMIT 1000");
const messages = messagesFromDb.map(({ text }) => text);

console.log(
  "LNURL encoded address to sendText:\n" +
    bech32.encode("lnurl", bech32.toWords(new Buffer(`${HOST}/sendText`)), 1024)
);

let request = 0;
const callbacks: Set<string> = new Set();

interface ISendTextCallbackParams {
  callback: string;
}
interface ISendTextCallbackQueryParams {
  amount: string;
  nonce?: string;
  fromnodes?: string;
  comment?: string;
}

server.get("/sendText", async () => {
  const callback = crypto
    .createHash("sha256")
    .update(`${request++}`)
    .digest("hex");
  callbacks.add(callback);

  // Delete the callback after 1h
  // TODO sync with invoice
  setTimeout(() => callbacks.delete(callback), 1000 * 60 * 60);

  return {
    tag: "payRequest",
    callback: `${HOST}/sendTextCallback/${callback}`,
    maxSendable: 1000,
    minSendable: 1000,
    metadata: responseMetadata,
    commentAllowed: 144,
  };
});

server.get<{
  Params: ISendTextCallbackParams;
  Querystring: unknown;
}>("/sendTextCallback/:callback", async (request, response) => {
  console.log("sendTextCallback");
  const callback = request.params.callback;
  if (false && !callbacks.has(callback)) {
    console.error("Got invalid callback");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "Invalid request. Missing callback",
    });
    return;
  }

  const query = request.query;
  if (!validate_sendTextCallbackQueryParams(query)) {
    throw new Error("Invalid request. Missing params");
  }
  const { amount, comment, fromnodes, nonce } = query;
  console.log(query);
  console.log(comment);

  if (!comment) {
    console.error("Got invalid comment");
    response.code(400);
    response.send({
      status: "ERROR",
      reason: "You must provide a comment",
    });
    return;
  }

  const invoice = await lnService.createInvoice({
    lnd,
    tokens: 1,
    description: "Comment on lnurl-pay chat 📝",
    description_hash: crypto.createHash("sha256").update(responseMetadata).digest(),
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
    if (invoice.is_confirmed) {
      console.log(`${invoice.request.substring(0, 20)}... is confirmed!`);
      db.run(
        `INSERT INTO message
        (text)
        VALUES
        ($text)`,
        { $text: comment }
      );
      messages.push(comment);
      callbacks.delete(callback);
    }
  });
});

function validate_sendTextCallbackQueryParams(params: any): params is ISendTextCallbackQueryParams {
  return true;
}

server.get("/messages", async () => {
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
