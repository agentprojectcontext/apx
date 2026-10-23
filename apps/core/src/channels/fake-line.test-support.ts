// LINE's Messaging API on localhost for tests: the bot's info, profiles, group summaries, reply (each token once),
// push, the loading animation and message content, plus signed webhook deliveries for a test to hand the channel.
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { HookRequest } from "./types.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN = "fakeLineChannelAccessToken0fakeLineChannelAccessToken0+/=";

type Sent = { via: "reply" | "push"; to: string; messages: Array<Record<string, unknown>> };
type Event = Record<string, unknown>;

export async function fakeLine() {
  const profiles = new Map<string, string>();
  const groupNames = new Map<string, string>();
  const tokens = new Map<string, { to: string; used: boolean }>();
  const images = new Map<string, Buffer>();
  const sent: Sent[] = [];
  const loading: string[] = [];
  let n = 1;
  const json = (res: http.ServerResponse, status: number, j: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(j));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    if (p.startsWith("/avatar/")) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(Buffer.from("png-bytes"));
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      return json(res, 401, { message: "Authentication failed due to the following reason: invalid token" });
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (p === "/v2/bot/info") return json(res, 200, { userId: "Ubot", basicId: "@123abcde", displayName: "Acme Bot" });
    const profile = /^\/v2\/bot\/(?:profile|(?:group|room)\/[^/]+\/member)\/([^/]+)$/.exec(p)?.[1];
    if (profile) {
      const name = profiles.get(profile);
      if (!name) return json(res, 404, { message: "Not found" });
      return json(res, 200, { userId: profile, displayName: name, pictureUrl: `${api}/avatar/${profile}` });
    }
    const summary = /^\/v2\/bot\/group\/([^/]+)\/summary$/.exec(p)?.[1];
    if (summary) return json(res, 200, { groupId: summary, groupName: groupNames.get(summary) ?? "" });
    const content = /^\/v2\/bot\/message\/([^/]+)\/content$/.exec(p)?.[1];
    if (content) {
      const img = images.get(content);
      if (!img) return json(res, 404, { message: "Not found" });
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(img);
    }
    if (p === "/v2/bot/chat/loading/start") {
      loading.push(String(body.chatId));
      return json(res, 202, {});
    }
    const messages = (body.messages ?? []) as Sent["messages"];
    const ids = () => ({ sentMessages: messages.map(() => ({ id: String(n++), quoteToken: "q" })) });
    if (p === "/v2/bot/message/reply") {
      const t = tokens.get(String(body.replyToken));
      if (!t || t.used) return json(res, 400, { message: "Invalid reply token" });
      t.used = true;
      sent.push({ via: "reply", to: t.to, messages });
      return json(res, 200, ids());
    }
    if (p === "/v2/bot/message/push") {
      sent.push({ via: "push", to: String(body.to), messages });
      return json(res, 200, ids());
    }
    return json(res, 404, { message: "Not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** An event from `from` in their one-to-one chat, or in `group`; it carries a fresh reply token. */
  const event = (type: string, from: string, extra: Event, group?: string): Event => {
    const replyToken = `rt${n++}`;
    const to = group ?? from;
    tokens.set(replyToken, { to, used: false });
    return {
      type,
      mode: "active",
      timestamp: Date.now(),
      webhookEventId: `01WEBHOOK${n++}`,
      deliveryContext: { isRedelivery: false },
      replyToken,
      source: group ? { type: "group", groupId: group, userId: from } : { type: "user", userId: from },
      ...extra,
    };
  };

  return {
    api,
    secret: `${SECRET} ${TOKEN}`,
    sent,
    loading,
    /** A LINE user the bot can see. */
    person: (id: string, name: string) => void profiles.set(id, name),
    group: (id: string, name: string) => void groupNames.set(id, name),
    /** A text message; `mention` @mentions the bot at the start of the text. */
    text(from: string, text: string, opts: { group?: string; mention?: boolean } = {}): Event {
      const id = String(n++);
      const said = opts.mention ? `@Acme Bot ${text}` : text;
      const mention = opts.mention ? { mentionees: [{ index: 0, length: 9, type: "user", isSelf: true }] } : undefined;
      return event(
        "message",
        from,
        { message: { id, type: "text", text: said, quoteToken: `quote-${id}`, ...(mention ? { mention } : {}) } },
        opts.group,
      );
    },
    image(from: string, bytes: Buffer): Event {
      const id = String(n++);
      images.set(id, bytes);
      return event("message", from, { message: { id, type: "image", contentProvider: { type: "line" } } });
    },
    postback: (from: string, data: string) => event("postback", from, { postback: { data } }),
    join: (group: string) => ({ ...event("join", "", {}, group), source: { type: "group", groupId: group } }),
    /** A delivery of these events to the channel's address, signed as LINE signs it (or with `signature`). */
    hook(events: Event[], signature?: string): HookRequest {
      const body = Buffer.from(JSON.stringify({ destination: "Ubot", events }));
      const sig = signature ?? createHmac("sha256", SECRET).update(body).digest("base64");
      return { method: "POST", path: "", headers: { "x-line-signature": sig }, body };
    },
    /** Texts the bot sent to `to` (a user, group or chat id). */
    sentTo: (to: string) => sent.filter((s) => s.to === to).flatMap((s) => s.messages.map((m) => String(m.text ?? ""))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
