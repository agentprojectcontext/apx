// An ntfy server on localhost for tests: one protected topic, its JSON stream (with `since` replay and `poll`), and
// publishing by POST or PUT. Like the real one, what is published comes back to every subscriber, tags and all.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Message = {
  id: string;
  time: number;
  event: "message";
  topic: string;
  message: string;
  tags?: string[];
  attachment?: { name: string; type: string; size: number; url: string };
};

export async function fakeNtfy() {
  const TOKEN = "tk_fakentfytoken000000001";
  const TOPIC = "apx-test-topic";
  const cached: Message[] = [];
  const streams = new Set<http.ServerResponse>();
  const files = new Map<string, Buffer>();
  const subscribes: string[] = [];
  let n = 1;
  let base = "";

  const add = (m: Omit<Message, "id" | "time" | "event" | "topic">): Message => {
    const msg: Message = { id: `m${n++}`, time: Math.floor(Date.now() / 1000), event: "message", topic: TOPIC, ...m };
    cached.push(msg);
    for (const s of streams) s.write(`${JSON.stringify(msg)}\n`);
    return msg;
  };
  const after = (since: string | null): Message[] => {
    if (!since) return [];
    if (/^\d+$/.test(since)) return cached.filter((m) => m.time >= Number(since));
    const at = cached.findIndex((m) => m.id === since);
    return at < 0 ? [...cached] : cached.slice(at + 1);
  };
  const raw = (req: http.IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const file = /^\/file\/(.+)$/.exec(url.pathname);
    if (file) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(files.get(file[1] ?? ""));
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: 40301, error: "forbidden" }));
    }
    if (url.pathname === `/${TOPIC}/json` && req.method === "GET") {
      const since = url.searchParams.get("since");
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      if (url.searchParams.get("poll") === "1") {
        for (const m of after(since)) res.write(`${JSON.stringify(m)}\n`);
        return res.end();
      }
      subscribes.push(since ?? "");
      res.write(`${JSON.stringify({ id: "o1", event: "open", topic: TOPIC })}\n`);
      for (const m of after(since)) res.write(`${JSON.stringify(m)}\n`);
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (url.pathname === `/${TOPIC}` && (req.method === "POST" || req.method === "PUT")) {
      const body = await raw(req);
      const tags = String(req.headers["x-tags"] ?? "")
        .split(",")
        .filter(Boolean);
      const name = req.headers.filename ? String(req.headers.filename) : undefined;
      const msg = name
        ? add({
            message: name,
            tags,
            attachment: { name, type: "image/png", size: body.length, url: `${base}/file/x` },
          })
        : add({ message: body.toString("utf8"), tags });
      if (name) files.set("x", body);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(msg));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    secret: `${base} ${TOPIC} ${TOKEN}`,
    topic: TOPIC,
    base,
    /** The owner writes on the topic (from the ntfy app: no tags). */
    write(text: string) {
      add({ message: text });
    },
    /** The owner sends a picture. */
    picture(name: string, data: Buffer) {
      files.set(name, data);
      add({ message: name, attachment: { name, type: "image/png", size: data.length, url: `${base}/file/${name}` } });
    },
    /** Texts APX published (tagged as its own). */
    published: () => cached.filter((m) => m.tags?.includes("apx")).map((m) => m.message),
    /** The `since` of each subscription opened, in order. */
    subscribes,
    /** Ends every open subscription, as a server restart would. */
    drop() {
      for (const s of streams) s.end();
      streams.clear();
    },
    close: async () => {
      for (const s of streams) s.end();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
