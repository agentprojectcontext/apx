// Twilio's Messages API on localhost for tests: the account check, the message list the SMS adapter polls and the
// send, plus a way for a test to text the number and to read what the agent sent.
import http from "node:http";
import type { AddressInfo } from "node:net";

const SID = `AC${"0123456789abcdef".repeat(2)}`;
const AUTH = "fa4e0auth0token0fa4e0auth0token0";
const FROM = "+15550001111";

type Msg = { sid: string; from: string; to: string; body: string; direction: string; date_created: string };

export async function fakeTwilio() {
  const messages: Msg[] = [];
  const queries: URLSearchParams[] = [];
  /** Numbers that answered STOP: a send to them fails as Twilio's does. */
  const stopped = new Set<string>();
  let n = 1;
  const rfc2822 = (d: Date) => d.toUTCString().replace("GMT", "+0000");
  const json = (res: http.ServerResponse, status: number, j: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(j));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const auth = `Basic ${Buffer.from(`${SID}:${AUTH}`).toString("base64")}`;
    if (req.headers.authorization !== auth) return json(res, 401, { code: 20003, message: "Authenticate" });
    const root = `/2010-04-01/Accounts/${SID}`;
    if (url.pathname === `${root}.json`) return json(res, 200, { sid: SID, status: "active" });
    if (url.pathname !== `${root}/Messages.json`) return json(res, 404, { code: 20404, message: "not found" });
    if (req.method === "GET") {
      queries.push(url.searchParams);
      const to = url.searchParams.get("To");
      // Newest first, as Twilio lists them.
      const list = messages.filter((m) => m.to === to).reverse();
      return json(res, 200, { messages: list.slice(0, Number(url.searchParams.get("PageSize") ?? 50)) });
    }
    let raw = "";
    for await (const c of req) raw += c;
    const form = new URLSearchParams(raw);
    const to = form.get("To") ?? "";
    if (stopped.has(to))
      return json(res, 400, { code: 21610, message: "Attempt to send to unsubscribed recipient", status: 400 });
    const m = {
      sid: `SM${n++}`,
      from: form.get("From") ?? "",
      to,
      body: form.get("Body") ?? "",
      direction: "outbound-api",
      date_created: rfc2822(new Date()),
    };
    messages.push(m);
    return json(res, 201, m);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    api,
    secret: `${SID} ${AUTH} ${FROM}`,
    queries,
    stopped,
    /** An SMS from `from` to the channel's number, received now (or `at`). */
    message(from: string, body: string, at = new Date()): string {
      const sid = `SM${n++}`;
      messages.push({ sid, from, to: FROM, body, direction: "inbound", date_created: rfc2822(at) });
      return sid;
    },
    /** Texts the agent sent to `to`. */
    sentTo: (to: string) => messages.filter((m) => m.to === to && m.direction !== "inbound").map((m) => m.body),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
