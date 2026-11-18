type SigningKey = JsonWebKey & { kid: string };
type KeySet = { keys: SigningKey[] };
const KEY_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

function decode(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error("sign_in_required");
  try {
    return Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("sign_in_required");
  }
}
function record(part: string): Record<string, unknown> {
  let result: unknown;
  try {
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decode(part)));
  } catch {
    throw new Error("sign_in_required");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("sign_in_required");
  return result as Record<string, unknown>;
}

/** Only Google's fixed Secure Token key set may establish an identity. */
export function createTokenVerifier(deps: { project: string; fetch?: typeof fetch; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let cached: { keys: SigningKey[]; until: number; fetchedAt: number } | undefined;
  let pending: Promise<SigningKey[]> | undefined;
  async function keys(force = false) {
    if (!force && cached && cached.until > now()) return cached.keys;
    if (pending) return pending;
    pending = (async () => {
      const response = await (deps.fetch ?? fetch)(KEY_URL, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("public_artifact_unavailable");
      const text = await response.text();
      if (text.length > 64_000) throw new Error("public_artifact_unavailable");
      const result = JSON.parse(text) as KeySet;
      if (!Array.isArray(result.keys) || result.keys.length > 20) throw new Error("public_artifact_unavailable");
      const ttl = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 300);
      cached = { keys: result.keys, fetchedAt: now(), until: now() + Math.min(Math.max(ttl, 0), 3600) * 1000 };
      return result.keys;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }
  return async (authorization: string | null) => {
    if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384) throw new Error("sign_in_required");
    const token = authorization.slice(7);
    const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) throw new Error("sign_in_required");
    const header = record(headerPart);
    const claims = record(payloadPart);
    const seconds = Math.floor(now() / 1000);
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length > 128 ||
      "crit" in header ||
      claims.aud !== deps.project ||
      claims.iss !== `https://securetoken.google.com/${deps.project}` ||
      typeof claims.sub !== "string" ||
      !claims.sub.length ||
      claims.sub.length > 128 ||
      claims.sub.includes("/") ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= seconds ||
      typeof claims.iat !== "number" ||
      !Number.isFinite(claims.iat) ||
      claims.iat > seconds ||
      typeof claims.auth_time !== "number" ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time > seconds ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > seconds))
    )
      throw new Error("sign_in_required");
    const select = (values: SigningKey[]) =>
      values.find(
        (candidate) =>
          candidate.kid === header.kid &&
          candidate.kty === "RSA" &&
          (!candidate.alg || candidate.alg === "RS256") &&
          (!candidate.use || candidate.use === "sig"),
      );
    let key = select(await keys());
    if (!key && cached && now() - cached.fetchedAt >= 60_000) key = select(await keys(true));
    if (!key) throw new Error("sign_in_required");
    const imported = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      imported,
      decode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) throw new Error("sign_in_required");
    return { uid: claims.sub, idToken: token };
  };
}
