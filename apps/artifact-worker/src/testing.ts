import { Buffer } from "node:buffer";
import { convertV4MiniflareOptions, Response as LocalResponse, Miniflare } from "miniflare";
import { localWorkerModules } from "./local-modules.ts";

/** Local integration fixture: real workerd/R2/DO, Google's key transport replaced, demo Firestore only. */
export async function startArtifactWorker(deps: { emulator: string; port?: number }) {
  if (!/^127\.0\.0\.1:\d+$/.test(deps.emulator)) throw new Error("A loopback demo emulator is required");
  const project = "demo-apx-artifacts";
  const uid = "test-viewer";
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (!("publicKey" in keys)) throw new Error("Expected an RSA key pair");
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: "integration",
    alg: "RS256",
    use: "sig",
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(Date.now() / 1000);
  const head = encode({ alg: "RS256", kid: "integration" });
  const privateKey = keys.privateKey;
  async function identity(user: string) {
    const payload = encode({
      sub: user,
      user_id: user,
      aud: project,
      iss: `https://securetoken.google.com/${project}`,
      iat: seconds - 60,
      auth_time: seconds - 60,
      exp: seconds + 3600,
      firebase: { sign_in_provider: "google.com", identities: {} },
    });
    const signed = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${head}.${payload}`),
    );
    return { uid: user, token: `${head}.${payload}.${Buffer.from(signed).toString("base64url")}` };
  }
  const identities: Record<string, { uid: string; token: string }> = {};
  for (const name of [
    "viewer",
    "engine-firefox",
    "engine-webkit",
    "card-1280",
    "card-390",
    "panel-1280",
    "panel-390",
    "spanish-1280",
    "spanish-390",
  ])
    identities[name] = await identity(`test-${name}`);
  const token = identities.viewer?.token;
  if (!token) throw new Error("Missing viewer identity");
  let offline = false;
  let firestoreRequests = 0;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      ...(await localWorkerModules()),
      compatibilityDate: "2026-11-13",
      ...(deps.port ? { port: deps.port } : {}),
      bindings: { FIREBASE_PROJECT: project },
      r2Buckets: ["COPIES"],
      durableObjects: {
        ACCOUNTS: { className: "PublicationAccount", useSQLite: true },
        BUDGET: { className: "PublicationBudget", useSQLite: true },
      },
      ratelimits: { IP_LIMIT: { namespace_id: "24601", simple: { limit: 120, period: 60 } } },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === "www.googleapis.com") return LocalResponse.json({ keys: [jwk] });
        if (url.hostname !== "firestore.googleapis.com" || !url.pathname.startsWith(`/v1/projects/${project}/`))
          throw new Error("Unexpected outbound request in public-copy fixture");
        firestoreRequests++;
        if (offline) return LocalResponse.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
        const response = await fetch(`http://${deps.emulator}${url.pathname}${url.search}`, {
          method: request.method,
          headers: { authorization: request.headers.get("authorization") ?? "", "content-type": "application/json" },
          redirect: "error",
          ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}),
        });
        return new LocalResponse(await response.arrayBuffer(), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  );
  try {
    const origin = (await mf.ready).origin;
    return {
      origin,
      uid,
      token,
      identities,
      close: () => mf.dispose(),
      stopFirestore: () => {
        offline = true;
      },
      firestoreRequests: () => firestoreRequests,
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
