// Google sign-in for the owner's own account: the consent URL (PKCE, signed short-lived state), the code exchange and
// access tokens minted from the stored refresh token. node:crypto and fetch, no Google SDK.
import crypto from "node:crypto";

export type GoogleEndpoints = {
  auth: string;
  token: string;
  calendar: string;
  gmail: string;
  drive: string;
  driveUpload: string;
};

export const GOOGLE: GoogleEndpoints = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  calendar: "https://www.googleapis.com/calendar/v3",
  gmail: "https://gmail.googleapis.com/gmail/v1",
  drive: "https://www.googleapis.com/drive/v3",
  driveUpload: "https://www.googleapis.com/upload/drive/v3",
};

/** Every endpoint under one address: a stand-in Google for tests. */
export const googleAt = (base: string): GoogleEndpoints => ({
  auth: `${base}/auth`,
  token: `${base}/token`,
  calendar: `${base}/calendar/v3`,
  gmail: `${base}/gmail/v1`,
  drive: `${base}/drive/v3`,
  driveUpload: `${base}/upload/drive/v3`,
});

export const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/** A PKCE pair: the verifier stays in the core, Google sees only its hash. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
}

/**
 * Signs the `state` a consent URL carries. The key lives only in this process: a restart voids any sign-in link
 * still open, which is fine for a flow that lasts minutes.
 */
export function stateSigner(ttlMs: number, now: () => number = Date.now) {
  const key = crypto.randomBytes(32);
  const mac = (body: string) => b64url(crypto.createHmac("sha256", key).update(body).digest());
  return {
    sign(payload: Record<string, string>): string {
      const body = b64url(JSON.stringify({ ...payload, exp: now() + ttlMs }));
      return `${body}.${mac(body)}`;
    },
    /** The payload, or undefined for a forged, altered or expired state. */
    verify(token: string): Record<string, string> | undefined {
      const [body, sig, extra] = token.split(".");
      if (!body || !sig || extra !== undefined) return undefined;
      const want = Buffer.from(mac(body));
      const got = Buffer.from(sig);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return undefined;
      try {
        const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
        if (typeof data.exp !== "number" || data.exp < now()) return undefined;
        const { exp: _, ...rest } = data;
        return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)]));
      } catch {
        return undefined;
      }
    },
  };
}

/** `access_type=offline` and `prompt=consent`: Google hands back a refresh token every time, reconnects included. */
export function authUrl(
  endpoints: GoogleEndpoints,
  o: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string },
): string {
  const u = new URL(endpoints.auth);
  const q = u.searchParams;
  q.set("client_id", o.clientId);
  q.set("redirect_uri", o.redirectUri);
  q.set("response_type", "code");
  q.set("scope", o.scopes.join(" "));
  q.set("access_type", "offline");
  q.set("prompt", "consent");
  q.set("include_granted_scopes", "true");
  q.set("state", o.state);
  q.set("code_challenge", o.challenge);
  q.set("code_challenge_method", "S256");
  return u.toString();
}

type TokenAnswer = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  endpoints: GoogleEndpoints,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenAnswer> {
  const res = await fetchImpl(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok) throw new GoogleAuthError(data.error ?? `HTTP ${res.status}`, data.error_description);
  return data;
}

/** Google refused a token request: `code` is its OAuth error ("invalid_grant": the sign-in was revoked). */
export class GoogleAuthError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(`Google refused the sign-in: ${detail || code}`);
    this.code = code;
  }
}

export type ClientCreds = { clientId: string; clientSecret: string };

/** The code Google sent back, for the refresh token and the account it belongs to. */
export async function exchangeCode(
  endpoints: GoogleEndpoints,
  c: ClientCreds & { code: string; redirectUri: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string | undefined; expiresIn: number; email: string | undefined }> {
  const data = await tokenRequest(
    endpoints,
    {
      grant_type: "authorization_code",
      code: c.code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      code_verifier: c.verifier,
    },
    fetchImpl,
  );
  if (!data.refresh_token)
    throw new GoogleAuthError(
      "no_refresh_token",
      "no refresh token came back; remove APX at myaccount.google.com/permissions and sign in again",
    );
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
    email: emailOf(data.id_token),
  };
}

/** A fresh access token for a refresh token. */
export async function refreshAccess(
  endpoints: GoogleEndpoints,
  c: ClientCreds & { refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const data = await tokenRequest(
    endpoints,
    {
      grant_type: "refresh_token",
      refresh_token: c.refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    },
    fetchImpl,
  );
  if (!data.access_token) throw new GoogleAuthError("no_access_token");
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

/** The account's email from the id_token Google's token endpoint just sent (only shown to the owner). */
export function emailOf(idToken: string | undefined): string | undefined {
  const seg = idToken?.split(".")[1];
  if (!seg) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : undefined;
  } catch {
    return undefined;
  }
}
