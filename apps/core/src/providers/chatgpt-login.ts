// The owner's ChatGPT plan as a model for APX's own loop: APX's own sign-in (device code, the way Codex signs in),
// kept in the secret store and refreshed here. Never Codex CLI's tokens (each keeps its own refresh family).
// See DECISIONS.md#d-042
import fs from "node:fs";
import type { Secrets } from "../secrets.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const SECRET = "chatgpt_login";
/** Refresh this long before the access token runs out. */
const SKEW_S = 120;
const DEVICE_WINDOW_MS = 15 * 60_000;

type Stored = { access_token: string; refresh_token: string; account_id?: string };
export type ChatgptCredentials = { token: string; headers: Record<string, string> };
export type DeviceCode = { user_code: string; verification_url: string; expires_at: string };
export type ChatgptStatus = {
  connected: boolean;
  /** The plan's email or account, when the token names it. */
  account?: string | undefined;
  /** A sign-in in progress: the code to type at the address. */
  pending?: DeviceCode | undefined;
  /** The last sign-in that did not finish, and why. */
  error?: string | undefined;
};

const claims = (jwt: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};
const authClaims = (jwt: string) => (claims(jwt)["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;

export class LoginError extends Error {
  /** The owner has to sign in again (the refresh token was refused). */
  readonly relogin: boolean;
  constructor(message: string, relogin = false) {
    super(message);
    this.name = "LoginError";
    this.relogin = relogin;
  }
}

export function createChatgptLogin(deps: {
  secrets: Secrets;
  /** auth.openai.com; a test points it at a fake. */
  issuer?: string;
  fetchImpl?: typeof fetch;
}) {
  const issuer = (deps.issuer ?? "https://auth.openai.com").replace(/\/$/, "");
  const f = deps.fetchImpl ?? fetch;
  let refreshing: Promise<Stored> | undefined;
  let device: (DeviceCode & { device_auth_id: string; timer?: ReturnType<typeof setTimeout> }) | undefined;
  let lastError: string | undefined;

  const read = (): Stored | undefined => {
    const raw = deps.secrets.resolve(`secret://${SECRET}`);
    if (!raw) return undefined;
    try {
      const s = JSON.parse(raw) as Stored;
      return s.access_token && s.refresh_token ? s : undefined;
    } catch {
      return undefined;
    }
  };
  const save = (s: Stored) => {
    const account = String(authClaims(s.access_token).chatgpt_account_id ?? s.account_id ?? "");
    deps.secrets.set(SECRET, JSON.stringify({ ...s, ...(account ? { account_id: account } : {}) }));
  };

  async function token(body: URLSearchParams): Promise<Record<string, unknown>> {
    const res = await f(`${issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.access_token !== "string") {
      const code = String(json.error ?? `HTTP ${res.status}`);
      const relogin =
        res.status === 401 || res.status === 403 || /invalid_grant|invalid_token|refresh_token_reused/.test(code);
      throw new LoginError(`ChatGPT sign-in refused (${code})`, relogin);
    }
    return json;
  }

  /** One refresh at a time; a refused refresh token ends the sign-in, so Settings asks to sign in again. */
  function renewed(s: Stored): Promise<Stored> {
    refreshing ??= refresh(s)
      .catch((err: unknown) => {
        if (err instanceof LoginError && err.relogin) {
          deps.secrets.set(SECRET, null);
          lastError = "the ChatGPT session expired: sign in again";
        }
        throw err;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  }

  const credentialsOf = (s: Stored): ChatgptCredentials => {
    const auth = authClaims(s.access_token);
    const account = String(auth.chatgpt_account_id ?? s.account_id ?? "");
    if (!account) throw new LoginError("the ChatGPT sign-in names no account: sign in again", true);
    return { token: s.access_token, headers: { "chatgpt-account-id": account, originator: "apx" } };
  };

  async function refresh(s: Stored): Promise<Stored> {
    const json = await token(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: CLIENT_ID }),
    );
    const next: Stored = {
      access_token: String(json.access_token),
      refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : s.refresh_token,
      ...(s.account_id ? { account_id: s.account_id } : {}),
    };
    save(next);
    return next;
  }

  async function poll(): Promise<void> {
    const d = device;
    if (!d) return;
    if (Date.now() > Date.parse(d.expires_at)) {
      device = undefined;
      lastError = "the code expired before the sign-in finished";
      return;
    }
    try {
      const res = await f(`${issuer}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ device_auth_id: d.device_auth_id, user_code: d.user_code }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 403 || res.status === 404) {
        d.timer = setTimeout(() => void poll(), 5000);
        d.timer.unref?.();
        return;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !json.authorization_code || !json.code_verifier) throw new Error(`HTTP ${res.status}`);
      const tokens = await token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: String(json.authorization_code),
          redirect_uri: `${issuer}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: String(json.code_verifier),
        }),
      );
      if (typeof tokens.refresh_token !== "string") throw new Error("no refresh token");
      save({ access_token: String(tokens.access_token), refresh_token: tokens.refresh_token });
      device = undefined;
      lastError = undefined;
    } catch (err) {
      device = undefined;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    has: () => Boolean(read()),
    status(): ChatgptStatus {
      const s = read();
      const c = s ? claims(s.access_token) : {};
      const profile = (c["https://api.openai.com/profile"] ?? {}) as Record<string, unknown>;
      return {
        connected: Boolean(s),
        ...(s ? { account: String(profile.email ?? s.account_id ?? "") || undefined } : {}),
        ...(device
          ? {
              pending: {
                user_code: device.user_code,
                verification_url: device.verification_url,
                expires_at: device.expires_at,
              },
            }
          : {}),
        ...(lastError && !s ? { error: lastError } : {}),
      };
    },
    /** A token good for the next call (refreshed when close to expiry, one refresh at a time) and its headers. */
    async credentials(): Promise<ChatgptCredentials> {
      let s = read();
      if (!s) throw new LoginError("ChatGPT is not connected: sign in from Settings › Engines", true);
      const exp = Number(claims(s.access_token).exp ?? 0);
      if (exp && exp - SKEW_S <= Date.now() / 1000) s = await renewed(s);
      return credentialsOf(s);
    },
    /** A fresh token after the API refused the current one (it can expire before its own `exp` says). */
    async renew(): Promise<ChatgptCredentials> {
      const s = read();
      if (!s) throw new LoginError("ChatGPT is not connected: sign in from Settings › Engines", true);
      return credentialsOf(await renewed(s));
    },
    /** Starts a device sign-in: the owner types the code at the address; the core waits for it in the background. */
    async start(): Promise<DeviceCode> {
      if (device?.timer) clearTimeout(device.timer);
      const res = await f(`${issuer}/api/accounts/deviceauth/usercode`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID }),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !json.user_code || !json.device_auth_id)
        throw new LoginError(
          res.status === 429 ? "OpenAI is limiting sign-ins right now; try again in a minute" : `HTTP ${res.status}`,
        );
      const interval = Math.max(3, Number(json.interval) || 5) * 1000;
      device = {
        user_code: String(json.user_code),
        device_auth_id: String(json.device_auth_id),
        verification_url: `${issuer}/codex/device`,
        expires_at: new Date(Date.now() + DEVICE_WINDOW_MS).toISOString(),
      };
      lastError = undefined;
      device.timer = setTimeout(() => void poll(), interval);
      device.timer.unref?.();
      return { user_code: device.user_code, verification_url: device.verification_url, expires_at: device.expires_at };
    },
    /** APX v1's own ChatGPT sign-in (its file is only read), taken over once so the owner need not sign in again. */
    importV1(file: string): boolean {
      try {
        const t = (JSON.parse(fs.readFileSync(file, "utf8")) as { tokens?: Partial<Stored> }).tokens;
        if (!t?.access_token || !t.refresh_token) return false;
        save({
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          ...(t.account_id ? { account_id: t.account_id } : {}),
        });
        return true;
      } catch {
        return false;
      }
    },
    disconnect(): void {
      if (device?.timer) clearTimeout(device.timer);
      device = undefined;
      deps.secrets.set(SECRET, null);
    },
    stop(): void {
      if (device?.timer) clearTimeout(device.timer);
    },
  };
}

export type ChatgptLogin = ReturnType<typeof createChatgptLogin>;
