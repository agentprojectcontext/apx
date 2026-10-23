// The Bot Framework on localhost for tests: its OpenID configuration and signing keys, Microsoft's token endpoint and
// a connector, plus signed activities as Teams would deliver them and a record of what the bot sent.
import { createSign, generateKeyPairSync } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { HookRequest } from "./types.ts";

const APP_ID = "00000000-0000-4000-8000-0000000000a1";
const TENANT = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "fake~client~secret";
const TOKEN = "eyJ.fake-bot-token";
const KID = "fake-kid-1";
export const TEAM = "19:acme-general@thread.tacv2";

type Sent = {
  method: string;
  conversation: string;
  replyTo?: string;
  body: { type?: string; text?: string; textFormat?: string; replyToId?: string; attachments?: unknown[] };
  id: string;
};

export async function fakeTeams() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sent: Sent[] = [];
  let n = 1;
  let base = "";
  const read = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => resolve(raw));
    });
  const json = (res: http.ServerResponse, status: number, j: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(j));
  };

  const server = http.createServer(async (req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    if (p === "/openid") return json(res, 200, { issuer: "https://api.botframework.com", jwks_uri: `${base}/keys` });
    if (p === "/keys")
      return json(res, 200, {
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", endorsements: ["msteams"] }],
      });
    if (p === `/${TENANT}/oauth2/v2.0/token`) {
      const form = new URLSearchParams(await read(req));
      const ok =
        form.get("grant_type") === "client_credentials" &&
        form.get("client_id") === APP_ID &&
        form.get("client_secret") === PASSWORD &&
        form.get("scope") === "https://api.botframework.com/.default";
      if (!ok) return json(res, 401, { error: "invalid_client", error_description: "AADSTS7000215: bad secret" });
      return json(res, 200, { access_token: TOKEN, expires_in: 3600, token_type: "Bearer" });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: { message: "bad token" } });
    const m = /^\/amer\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/.exec(p);
    if (m) {
      const conversation = decodeURIComponent(m[1] ?? "");
      const ref = m[2] ? decodeURIComponent(m[2]) : undefined;
      const body = JSON.parse(await read(req)) as Sent["body"];
      const id = req.method === "PUT" && ref ? ref : `out${n++}`;
      sent.push({ method: req.method ?? "", conversation, ...(ref ? { replyTo: ref } : {}), body, id });
      return json(res, 200, { id });
    }
    return json(res, 404, { error: { message: "not found" } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const serviceUrl = `${base}/amer/`;

  /** A JWT as the Bot Framework signs it; `claims` overrides any of its claims, `key` signs with another key. */
  function sign(claims: Record<string, unknown> = {}, key = privateKey): string {
    const now = Math.floor(Date.now() / 1000);
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${part({ alg: "RS256", typ: "JWT", kid: KID })}.${part({
      iss: "https://api.botframework.com",
      aud: APP_ID,
      serviceurl: serviceUrl,
      nbf: now - 10,
      exp: now + 3600,
      ...claims,
    })}`;
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key, "base64url")}`;
  }

  /** The request Teams makes to the bot's address for this activity, signed unless `auth` says otherwise. */
  function request(activity: object, auth: string | null = `Bearer ${sign()}`): HookRequest {
    return {
      method: "POST",
      path: "",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: Buffer.from(JSON.stringify(activity)),
    };
  }

  const bot = { id: `28:${APP_ID}`, name: "Acme Bot" };
  const user = (from: string) => ({ id: `29:${from}`, name: from, aadObjectId: `aad-${from}` });
  const personal = (from: string) => ({ id: `a:dm-${from}`, conversationType: "personal" });
  const activity = (from: string, more: object) => ({
    channelId: "msteams",
    serviceUrl,
    from: user(from),
    recipient: bot,
    id: `in${n++}`,
    ...more,
  });

  return {
    secret: `${APP_ID} ${PASSWORD} ${TENANT}`,
    appId: APP_ID,
    base,
    serviceUrl,
    sign,
    request,
    /** The personal chat's conversation id with `from`. */
    dm: (from: string) => personal(from).id,
    /** A message from `from`; `room` posts it in the team channel, @mentioning the bot (a new thread). */
    message(from: string, text: string, opts: { room?: boolean } = {}) {
      if (!opts.room)
        return activity(from, { type: "message", text, textFormat: "plain", conversation: personal(from) });
      const id = `root${n++}`;
      return activity(from, {
        type: "message",
        id,
        text: `<at>Acme Bot</at> ${text}`,
        conversation: { id: `${TEAM};messageid=${id}`, conversationType: "channel", isGroup: true },
        entities: [{ type: "mention", text: "<at>Acme Bot</at>", mentioned: bot }],
        channelData: { team: { name: "Acme" }, channel: { name: "General" } },
      });
    },
    /** `from` presses the Action.Submit button carrying `id` on the card message `ref`. */
    click: (from: string, id: string, ref: string) =>
      activity(from, { type: "message", value: { apx: id }, replyToId: ref, conversation: personal(from) }),
    /** The bot is added to the team channel. */
    added: () =>
      activity("owner", {
        type: "conversationUpdate",
        membersAdded: [bot],
        conversation: { id: TEAM, conversationType: "channel", isGroup: true },
        channelData: { team: { name: "Acme" }, channel: { name: "General" } },
      }),
    /** What the bot sent to `to`'s personal chat. */
    sentTo: (to: string) => sent.filter((s) => s.conversation === personal(to).id),
    sentIn: (conversation: string) => sent.filter((s) => s.conversation.startsWith(conversation)),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
