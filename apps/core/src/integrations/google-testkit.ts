import crypto from "node:crypto";
import { SETTINGS, type SettingKey } from "../domain/setting-keys.ts";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";
import { createGoogle } from "./google.ts";
import { googleAt } from "./google-oauth.ts";

export const BASE = "http://google.test";
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
export const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
};

function fakeGoogle() {
  const seen: Array<{ url: string; form?: URLSearchParams; auth?: string; method?: string; body?: unknown }> = [];
  let minted = 0;
  let challenge = "";
  let refuseNext = false;
  let revoked = false;
  let respond: ((url: URL, init?: RequestInit) => unknown) | undefined;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (url === `${BASE}/token`) {
      const form = new URLSearchParams(String(init?.body));
      seen.push({ url, form });
      if (!["s3cret", "apx-public"].includes(form.get("client_secret") ?? ""))
        return json(401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code") {
        const verifier = form.get("code_verifier") ?? "";
        const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (form.get("code") !== "good-code" || hash !== challenge) return json(400, { error: "invalid_grant" });
        return json(200, {
          access_token: "at-0",
          refresh_token: "rt-1",
          expires_in: 3600,
          id_token: idToken("owner@example.com"),
        });
      }
      if (revoked || form.get("refresh_token") !== "rt-1")
        return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      minted += 1;
      return json(200, { access_token: `at-${minted}`, expires_in: 3600 });
    }
    seen.push({
      url,
      ...(auth ? { auth } : {}),
      method: init?.method,
      ...(init?.body ? { body: parsed(String(init.body)) } : {}),
    });
    if (refuseNext) {
      refuseNext = false;
      return json(401, { error: { message: "Invalid Credentials" } });
    }
    const answer = respond?.(new URL(url), init) ?? { items: [] };
    return answer instanceof Response ? answer : json(200, answer);
  }) as typeof fetch;
  return {
    fetchImpl,
    seen,
    respond: (fn: (url: URL, init?: RequestInit) => unknown) => {
      respond = fn;
    },
    setChallenge: (c: string) => {
      challenge = c;
    },
    refuseNext: () => {
      refuseNext = true;
    },
    revoke: () => {
      revoked = true;
    },
  };
}

export function setup(o: { builtin?: boolean } = {}) {
  const settings = new Map<string, string>();
  const vault = new Map<string, string>();
  const store = {
    settings: {
      get: (k: string) => settings.get(k),
      set: (k: string, v: string) => settings.set(k, v),
      read: (k: SettingKey) => {
        const config = SETTINGS[k];
        return config.schema.parse(JSON.parse(settings.get(k) ?? JSON.stringify(config.fallback)));
      },
    },
  };
  const secrets = {
    resolve: (ref?: string) => (ref?.startsWith("secret://") ? vault.get(ref.slice(9)) : undefined),
    has: (ref?: string) => Boolean(ref && vault.has(ref.slice(9))),
    set: (name: string, value: string | null) => (value === null ? vault.delete(name) : vault.set(name, value)),
  };
  let clock = Date.parse("2026-05-04T12:00:00Z");
  const fake = fakeGoogle();
  const off = new Set<string>();
  const g = createGoogle({
    store: store as unknown as Store,
    secrets: secrets as unknown as Secrets,
    endpoints: googleAt(BASE),
    origin: () => "http://127.0.0.1:7440",
    offIn: (project, id) => off.has(`${project}:${id}`),
    fetch: fake.fetchImpl,
    now: () => clock,
    ...(o.builtin ? { builtin: { clientId: "apx.apps.googleusercontent.com", clientSecret: "apx-public" } } : {}),
  });
  const start = (id: "google-calendar" | "gmail" | "google-drive" = "google-calendar") => {
    const url = new URL(g.start(id, { client_id: "123-abc.apps.googleusercontent.com", client_secret: "s3cret" }));
    fake.setChallenge(url.searchParams.get("code_challenge") ?? "");
    return url;
  };
  return { g, fake, vault, settings, off, start, tick: (ms: number) => (clock += ms) };
}
