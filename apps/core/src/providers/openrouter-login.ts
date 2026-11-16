// OpenRouter's sign-in (OAuth PKCE): the owner approves at openrouter.ai and APX gets a key of their own account.
import crypto from "node:crypto";

export const OPENROUTER_AUTH = "https://openrouter.ai/auth";
export const OPENROUTER_KEYS = "https://openrouter.ai/api/v1/auth/keys";
/** How long an approval started here can come back. */
const TTL_MS = 10 * 60_000;
const DEADLINE_MS = 20_000;

type Pending = { verifier: string; at: number };
type Options = { fetch?: typeof fetch; now?: () => number; auth?: string; keys?: string };

const b64url = (buf: Buffer) => buf.toString("base64url");

export function createOpenRouterLogin(opts: Options = {}) {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const pending = new Map<string, Pending>();
  const sweep = () => {
    for (const [k, v] of pending) if (now() - v.at > TTL_MS) pending.delete(k);
  };
  return {
    /** The page to approve at; OpenRouter sends the browser back to `callback` with `state` kept and a `code` added. */
    start(callback: string): { url: string } {
      sweep();
      const back = new URL(callback);
      if (back.protocol !== "http:" && back.protocol !== "https:") throw new Error("callback must be http(s)");
      const state = b64url(crypto.randomBytes(18));
      const verifier = b64url(crypto.randomBytes(32));
      pending.set(state, { verifier, at: now() });
      back.searchParams.set("state", state);
      const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
      const url = new URL(opts.auth ?? OPENROUTER_AUTH);
      url.searchParams.set("callback_url", back.toString());
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return { url: url.toString() };
    },
    /** Trades the code for the account's key; each state works once. */
    async finish(code: string, state: string): Promise<string> {
      sweep();
      const p = pending.get(state);
      if (!p) throw new Error("This sign-in expired or was already used: start it again");
      pending.delete(state);
      const res = await f(opts.keys ?? OPENROUTER_KEYS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, code_verifier: p.verifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(DEADLINE_MS),
      });
      if (!res.ok) throw new Error(`OpenRouter refused the sign-in (${res.status})`);
      const body = (await res.json()) as { key?: unknown };
      if (typeof body.key !== "string" || !body.key) throw new Error("OpenRouter sent no key");
      return body.key;
    },
  };
}

export type OpenRouterLogin = ReturnType<typeof createOpenRouterLogin>;
