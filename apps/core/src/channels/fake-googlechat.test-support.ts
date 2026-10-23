// Google's token endpoint, a Pub/Sub subscription and the Chat API on localhost for tests: just the calls the Google
// Chat adapter makes, plus a way for a test to write or click as someone and to read what the app sent.
import { generateKeyPairSync, verify } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

const SUBSCRIPTION = "projects/acme/subscriptions/apx-chat";
const TOKEN = "ya29.fake-access-token";

type Sent = { space: string; body: { text?: string; cardsV2?: unknown[]; thread?: { name?: string } }; name: string };

export async function fakeGoogleChat() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sent: Sent[] = [];
  const patched: Array<{ name: string; body: Record<string, unknown> }> = [];
  const acked: string[] = [];
  let queue: Array<{ ackId: string; event: object }> = [];
  let waiting: (() => void) | undefined;
  let n = 1;
  let base = "";
  const dm = (user: string) => `spaces/dm-${user}`;
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

  /** The JWT is signed by the key's private half, for the right scopes and audience. */
  function validAssertion(jwt: string): boolean {
    const [head, claims, sig] = jwt.split(".");
    if (!head || !claims || !sig) return false;
    if (!verify("RSA-SHA256", Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(sig, "base64url"))) return false;
    const c = JSON.parse(Buffer.from(claims, "base64url").toString()) as { scope?: string; aud?: string };
    return c.aud === `${base}/token` && !!c.scope?.includes("chat.bot") && !!c.scope.includes("pubsub");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    if (p === "/token") {
      const form = new URLSearchParams(await read(req));
      if (!validAssertion(form.get("assertion") ?? "")) return json(res, 400, { error: "invalid_grant" });
      return json(res, 200, { access_token: TOKEN, expires_in: 3600, token_type: "Bearer" });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: { message: "bad token" } });
    if (p === `/v1/${SUBSCRIPTION}` && req.method === "GET") return json(res, 200, { name: SUBSCRIPTION });
    if (p === `/v1/${SUBSCRIPTION}:pull`) {
      if (!queue.length)
        await new Promise<void>((r) => {
          waiting = r;
          setTimeout(r, 300);
        });
      const batch = queue;
      queue = [];
      return json(res, 200, {
        receivedMessages: batch.map((q) => ({
          ackId: q.ackId,
          message: { data: Buffer.from(JSON.stringify(q.event)).toString("base64"), messageId: q.ackId },
        })),
      });
    }
    if (p === `/v1/${SUBSCRIPTION}:acknowledge`) {
      const b = JSON.parse(await read(req)) as { ackIds?: string[] };
      acked.push(...(b.ackIds ?? []));
      return json(res, 200, {});
    }
    const post = /^\/v1\/(spaces\/[^/]+)\/messages$/.exec(p);
    if (post && req.method === "POST") {
      const name = `${post[1]}/messages/out${n++}`;
      sent.push({ space: post[1] ?? "", body: JSON.parse(await read(req)) as Sent["body"], name });
      return json(res, 200, { name });
    }
    if (/^\/v1\/spaces\/[^/]+\/messages\/[^/]+$/.test(p) && req.method === "PATCH") {
      patched.push({ name: p.slice(4), body: JSON.parse(await read(req)) as Record<string, unknown> });
      return json(res, 200, {});
    }
    return json(res, 404, { error: { message: "not found" } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const push = (event: object) => {
    const ackId = `ack${n++}`;
    queue.push({ ackId, event });
    waiting?.();
    return ackId;
  };
  const userOf = (from: string) => ({ name: `users/${from}`, displayName: from, type: "HUMAN" });
  const space = (from: string, group?: boolean) =>
    group
      ? { name: "spaces/team", type: "ROOM", spaceType: "SPACE", displayName: "Team" }
      : { name: dm(from), type: "DM", spaceType: "DIRECT_MESSAGE" };
  const key = {
    type: "service_account",
    client_email: "apx-chat@acme.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    token_uri: `${base}/token`,
  };

  return {
    /** The secret as the owner pastes it: the subscription, then the key's JSON over several lines. */
    secret: `${SUBSCRIPTION}\n${JSON.stringify(key, null, 2)}`,
    base,
    acked,
    patched,
    dm,
    /** A message from `from`; `group` puts it in a space (calling the app). Returns its ack id. */
    message(from: string, text: string, opts: { group?: boolean } = {}): string {
      const message = {
        name: `${space(from, opts.group).name}/messages/in${n++}`,
        text: opts.group ? `@APX ${text}` : text,
        ...(opts.group
          ? {
              argumentText: ` ${text}`,
              thread: { name: "spaces/team/threads/t1" },
              annotations: [{ type: "USER_MENTION", userMention: { user: { name: "users/app", type: "BOT" } } }],
            }
          : {}),
        sender: userOf(from),
      };
      return push({ type: "MESSAGE", space: space(from, opts.group), message, user: userOf(from) });
    },
    /** `from` clicks the card button carrying `id` on the message `name`. */
    click(from: string, id: string, name: string): string {
      return push({
        type: "CARD_CLICKED",
        space: space(from),
        message: { name },
        user: userOf(from),
        common: { invokedFunction: "apx", parameters: { id } },
      });
    },
    /** What the app sent to `to`'s direct space. */
    sentTo: (to: string) => sent.filter((s) => s.space === dm(to)),
    sentIn: (space: string) => sent.filter((s) => s.space === space),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
