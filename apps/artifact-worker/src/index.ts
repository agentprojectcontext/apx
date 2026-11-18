import { viewerAsset } from "./assets.ts";
import { createTokenVerifier } from "./auth.ts";
import { budgetedBucket } from "./budget.ts";

export { PublicationBudget } from "./budget.ts";

import { failure, secureResponse } from "./headers.ts";
import { metadataCloud, type Session } from "./metadata.ts";
import { mutate } from "./mutations.ts";
import { type PendingCopy, recoverPending, sweepUncertainCopy } from "./recovery.ts";
import { bodyKey, type Pointer, pointer, pointerKey, readCopy } from "./storage.ts";

type Env = {
  COPIES: R2Bucket;
  ACCOUNTS: DurableObjectNamespace;
  BUDGET: DurableObjectNamespace;
  IP_LIMIT: RateLimit;
  FIREBASE_PROJECT: string;
  FIRESTORE_ORIGIN?: string;
};
const codePattern = "([0-9abcdefghjkmnpqrstvwxyz]{8})";
function cloud(session: Session, env: Env) {
  if (
    env.FIRESTORE_ORIGIN &&
    (!env.FIREBASE_PROJECT.startsWith("demo-") || !/^http:\/\/127\.0\.0\.1:\d+$/.test(env.FIRESTORE_ORIGIN))
  )
    throw new Error("public_artifact_unavailable");
  return metadataCloud(session, { project: env.FIREBASE_PROJECT, origin: env.FIRESTORE_ORIGIN });
}
function document(
  code: string,
  meta: { title: string; sha256: string; bytes: number; revision: string; updated_at: string },
) {
  return {
    name: `publicArtifacts/${code}`,
    updateTime: meta.revision,
    fields: {
      title: { stringValue: meta.title },
      sha256: { stringValue: meta.sha256 },
      bytes: { integerValue: String(meta.bytes) },
      updated_at: { timestampValue: meta.updated_at },
    },
  };
}

async function isLive(env: Env, uid: string, code: string) {
  const actor = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(uid));
  const response = await actor.fetch(`https://account.internal/internal/live/${code}`, {
    headers: { "x-apx-uid": uid },
  });
  if (!response.ok) throw new Error("public_artifact_unavailable");
  return (await response.json<{ live: boolean }>()).live;
}

export function createWorker(files: Readonly<Record<string, string>>) {
  let verifier: { project: string; verify: ReturnType<typeof createTokenVerifier> } | undefined;
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      let result: Response;
      try {
        if (!(await env.IP_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "local" })).success)
          throw new Error("public_artifact_rate_limited");
        if (request.method !== "GET" && request.method !== "POST")
          return secureResponse(new Response(null, { status: 405 }), url.pathname, url.origin);
        const publicMatch = url.pathname.match(new RegExp(`^/api/copies/${codePattern}/(meta|bundle|events)$`));
        const privateMatch = url.pathname.match(
          new RegExp(`^/api/account/copies/${codePattern}/(available|inspect|publish|update|revoke)$`),
        );
        if (publicMatch && request.method === "GET" && publicMatch[2] === "events") {
          if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
            return secureResponse(new Response(null, { status: 426 }), url.pathname, url.origin);
          const code = publicMatch[1] ?? "";
          const head = await pointer(budgetedBucket(env.COPIES, env.BUDGET), code);
          if (!head) throw new Error("public_artifact_missing");
          const actor = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(head.uid));
          result = await actor.fetch(`https://account.internal/internal/watch/${code}`, {
            headers: { upgrade: "websocket", "x-apx-uid": head.uid },
          });
        } else if (publicMatch && request.method === "GET") {
          result = await readCopy(
            request,
            budgetedBucket(env.COPIES, env.BUDGET),
            caches.default,
            publicMatch[1] ?? "",
            publicMatch[2] ?? "",
            (uid, code) => isLive(env, uid, code),
          );
        } else if (privateMatch || url.pathname === "/api/account/copies") {
          if (!verifier || verifier.project !== env.FIREBASE_PROJECT)
            verifier = {
              project: env.FIREBASE_PROJECT,
              verify: createTokenVerifier({ project: env.FIREBASE_PROJECT }),
            };
          const session = await verifier.verify(request.headers.get("authorization"));
          const code = privateMatch?.[1] ?? "";
          const action = privateMatch?.[2];
          if (request.method === "GET" && action === "available") {
            result = Response.json({ available: await cloud(session, env).available(code) });
          } else if (request.method === "GET" && action === "inspect") {
            const head = await pointer(budgetedBucket(env.COPIES, env.BUDGET, true), code);
            if (!head) throw new Error("public_artifact_missing");
            if (head.uid !== session.uid) throw new Error("public_artifact_access_denied");
            if (!(await isLive(env, head.uid, code))) throw new Error("public_artifact_missing");
            result = Response.json(document(code, head.meta));
          } else if (request.method === "GET" && !action) {
            const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(session.uid));
            const headers = new Headers(request.headers);
            headers.set("x-apx-uid", session.uid);
            await account.fetch("https://account.internal/internal/cleanup", { method: "POST", headers });
            const slots = await cloud(session, env).slots();
            const documents = [];
            for (const slot of slots) {
              const target = slot.fields.code?.stringValue ?? "";
              if (!new RegExp(`^${codePattern}$`).test(target)) throw new Error("public_artifact_unavailable");
              const head = await pointer(budgetedBucket(env.COPIES, env.BUDGET, true), target);
              if (head && head.uid === session.uid && (await isLive(env, head.uid, target)))
                documents.push({ ...slot, publication: document(target, head.meta) });
            }
            result = Response.json({ documents });
          } else if (request.method === "POST" && ["publish", "update", "revoke"].includes(action ?? "")) {
            const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(session.uid));
            const internal = new Request(request);
            internal.headers.set("x-apx-uid", session.uid);
            result = await stub.fetch(internal);
          } else result = new Response(null, { status: 405 });
        } else if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_private-cache/")) {
          result = new Response(null, { status: 404 });
        } else if (
          request.method === "GET" &&
          (url.pathname === "/runner.html" ||
            url.pathname.startsWith("/assets/") ||
            url.pathname === "/" ||
            url.pathname === "/index.html" ||
            new RegExp(`^/${codePattern}$`).test(url.pathname))
        ) {
          const path =
            url.pathname === "/runner.html" || url.pathname.startsWith("/assets/") ? url.pathname : "/index.html";
          result = viewerAsset(files, path);
        } else result = new Response(null, { status: 404 });
      } catch (error) {
        result = failure(error);
      }
      return secureResponse(result, url.pathname, url.origin);
    },
  };
}

export class PublicationAccount {
  private ctx: DurableObjectState;
  private env: Env;
  private queue: Promise<void> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
  private async cleanup(session: Session) {
    const pending = await this.ctx.storage.list<Pointer>({ prefix: "cleanup/", limit: 1 });
    for (const [key, saved] of pending) {
      const code = key.slice("cleanup/".length);
      if (saved.uid !== session.uid) continue;
      try {
        const bucket = budgetedBucket(this.env.COPIES, this.env.BUDGET, true);
        await bucket.delete(pointerKey(code));
        await cloud(session, this.env).release(code, saved.slot);
        await bucket.delete(bodyKey(code, saved.meta.sha256));
        await this.ctx.storage.delete(key);
        const active = (await this.ctx.storage.get<string[]>("active")) ?? [];
        await this.ctx.storage.put(
          "active",
          active.filter((item) => item !== code),
        );
      } catch {}
    }
    if (pending.size) return;
    const abandoned = await this.ctx.storage.list<PendingCopy>({ prefix: "pending/", limit: 1 });
    for (const key of abandoned.keys()) {
      try {
        await this.recover(key.slice("pending/".length), session);
      } catch {}
    }
    await this.sweepUncertain(session);
  }
  private async sweepUncertain(session: Session) {
    const startAfter = await this.ctx.storage.get<string>("uncertain-cursor");
    const entries = await this.ctx.storage.list<{ code: string; sha256: string }>({
      prefix: "uncertain/",
      startAfter,
      limit: 1,
    });
    if (!entries.size) {
      await this.ctx.storage.delete("uncertain-cursor");
      return;
    }
    for (const [key, saved] of entries) {
      try {
        await sweepUncertainCopy(saved.code, saved.sha256, {
          bucket: budgetedBucket(this.env.COPIES, this.env.BUDGET, true),
          session,
          rawDelete: (key) => this.env.COPIES.delete(key),
        });
      } catch {}
      await this.ctx.storage.put("uncertain-cursor", key);
    }
  }
  private async recover(code: string, session: Session) {
    const key = `pending/${code}`;
    const saved = await this.ctx.storage.get<PendingCopy>(key);
    if (!saved) return;
    const current = await recoverPending(code, saved, {
      bucket: budgetedBucket(this.env.COPIES, this.env.BUDGET, true),
      cloud: cloud(session, this.env),
      session,
      rememberPending: (value) => this.ctx.storage.put(key, value),
      rememberUncertain: (hash) => this.ctx.storage.put(`uncertain/${code}/${hash}`, { code, sha256: hash }),
      rawDelete: (key) => this.env.COPIES.delete(key),
      revoked: !!(await this.ctx.storage.get(`revoked/${code}`)),
    });
    if (!current || current.uid !== session.uid) {
      const active = (await this.ctx.storage.get<string[]>("active")) ?? [];
      await this.ctx.storage.put(
        "active",
        active.filter((item) => item !== code),
      );
    }
    await this.ctx.storage.delete(key);
  }
  private broadcast(code: string, state: "live" | "missing") {
    const message = JSON.stringify({ state });
    for (const socket of this.ctx.getWebSockets(code)) {
      try {
        socket.send(message);
      } catch {
        try {
          socket.close();
        } catch {}
      }
    }
  }
  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "This connection only receives updates");
  }
  webSocketClose(socket: WebSocket) {
    try {
      socket.close(1000);
    } catch {}
  }
  async fetch(request: Request) {
    const watch = new URL(request.url).pathname.match(new RegExp(`^/internal/watch/${codePattern}$`));
    if (watch && request.headers.get("x-apx-uid") && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const code = watch[1] ?? "";
      if (await this.ctx.storage.get(`revoked/${code}`)) return new Response(null, { status: 404 });
      if (this.ctx.getWebSockets(code).length >= 20 || this.ctx.getWebSockets().length >= 100)
        return new Response(null, { status: 429 });
      const sockets = new WebSocketPair();
      this.ctx.acceptWebSocket(sockets[1], [code]);
      return new Response(null, { status: 101, webSocket: sockets[0] });
    }
    const live = new URL(request.url).pathname.match(new RegExp(`^/internal/live/${codePattern}$`));
    if (live && request.headers.get("x-apx-uid"))
      return Response.json({ live: !(await this.ctx.storage.get(`revoked/${live[1]}`)) });
    const next = this.queue.then(() => this.handle(request));
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  private async handle(request: Request) {
    try {
      const uid = request.headers.get("x-apx-uid");
      const token = request.headers.get("authorization")?.slice(7);
      if (uid && token && new URL(request.url).pathname === "/internal/cleanup") {
        await this.cleanup({ uid, idToken: token });
        return new Response(null, { status: 204 });
      }
      const match = new URL(request.url).pathname.match(
        new RegExp(`^/api/account/copies/${codePattern}/(publish|update|revoke)$`),
      );
      if (!uid || !token || !match) throw new Error("sign_in_required");
      const hour = Math.floor(Date.now() / 3_600_000);
      const before = await this.ctx.storage.get<{ hour: number; count: number }>("rate");
      const count = before?.hour === hour ? before.count : 0;
      if (count >= 60) throw new Error("public_artifact_rate_limited");
      await this.ctx.storage.put("rate", { hour, count: count + 1 });
      const session = { uid, idToken: token };
      const code = match[1] ?? "";
      const action = match[2] as "publish" | "update" | "revoke";
      const revoked = await this.ctx.storage.get<Pointer>(`revoked/${code}`);
      if (action !== "revoke" && revoked) throw new Error("public_artifact_missing");
      if (action !== "revoke") await this.recover(code, session);
      const bucket = budgetedBucket(this.env.COPIES, this.env.BUDGET, action === "revoke");
      const active = (await this.ctx.storage.get<string[]>("active")) ?? [];
      if (action === "publish" && !active.includes(code)) {
        if (active.length >= 20) throw new Error("public_artifact_limit");
        active.push(code);
        await this.ctx.storage.put("active", active);
      }
      try {
        const result = await mutate(request, {
          bucket,
          session,
          cloud: cloud(session, this.env),
          code,
          action,
          revoked,
          rememberPending: (value) => this.ctx.storage.put(`pending/${code}`, value),
          rememberRevocation: async (value) => {
            await this.ctx.storage.put({ [`revoked/${code}`]: value, [`cleanup/${code}`]: value });
            this.broadcast(code, "missing");
          },
        });
        if (action === "revoke") {
          try {
            await this.ctx.storage.put(
              "active",
              active.filter((item) => item !== code),
            );
          } catch {}
          if ("cleanup_pending" in result && !result.cleanup_pending) await this.ctx.storage.delete(`cleanup/${code}`);
        }
        try {
          await this.recover(code, session);
        } catch {
          if ("cleanup_pending" in result) result.cleanup_pending = true;
        }
        if ("sha256" in result) this.broadcast(code, "live");
        return Response.json(result);
      } finally {
        // Client-editable Firebase slots cannot be the trusted quota for R2 content.
        try {
          const latest = await pointer(bucket, code);
          if (!latest || latest.uid !== uid)
            await this.ctx.storage.put(
              "active",
              active.filter((item) => item !== code),
            );
        } catch {}
      }
    } catch (error) {
      return failure(error);
    }
  }
}
