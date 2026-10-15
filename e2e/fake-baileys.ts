// The library's surface backed by the in-memory WhatsApp of the core's tests, plus a small HTTP API (E2E_WA_PORT) for
// specs to act as the phone: scan the QR, write as the owner or as someone else, read what was sent, read it on the
// other side (receipts), react to it and come online.
import http from "node:http";
import { fakeWhatsApp } from "../apps/core/src/channels/fake-whatsapp.test-support.ts";

const wa = fakeWhatsApp();
export const {
  makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = wa.lib;
export default wa.lib;

const port = Number(process.env.E2E_WA_PORT ?? 0);
if (port)
  http
    .createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        const body = (raw ? JSON.parse(raw) : {}) as {
          from?: { phone: string; name: string };
          text?: string;
          jid?: string;
          status?: number;
          online?: boolean;
          emoji?: string;
          /** A message's content as the library hands it (a video, a document), its file's bytes in `bytes`. */
          content?: object;
        };
        const url = new URL(req.url ?? "/", "http://x");
        let out: unknown = { ok: true };
        if (url.pathname === "/scan") wa.scan();
        else if (url.pathname === "/owner") wa.fromOwner(String(body.text ?? ""));
        else if (url.pathname === "/message" && body.from) wa.message(body.from, String(body.text ?? ""));
        else if (url.pathname === "/media" && body.from && body.content)
          wa.message(body.from, "", { content: body.content });
        else if (url.pathname === "/receipt") {
          const last = wa.sent.filter((x) => x.jid === body.jid).at(-1);
          if (last) wa.receipt(last.id, Number(body.status ?? 3));
        } else if (url.pathname === "/react" && body.from) {
          const last = wa.sent.filter((x) => x.jid === body.from?.phone).at(-1);
          if (last) wa.react(body.from, last.id, String(body.emoji ?? ""));
        } else if (url.pathname === "/presence")
          wa.presence(String(body.jid ?? ""), body.online ? "available" : "unavailable");
        else if (url.pathname === "/sent")
          out = { owner: wa.owner, sent: wa.textsTo(url.searchParams.get("jid") ?? "") };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      });
    })
    .on("error", (err) => console.error(`fake WhatsApp phone: ${err.message}`))
    .listen(port, "127.0.0.1")
    .unref();
