import { randomBytes } from "node:crypto";
import type { ClientCreds } from "../integrations/google-oauth.ts";
import { pkce } from "../integrations/google-oauth.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import type { Secrets } from "../secrets.ts";
import { ACCOUNT_ENDPOINTS, accountAuthUrl, accountPost } from "./auth.ts";
import { exchangeAccountCode, renewAccountSession, type AccountSession as Session } from "./exchange.ts";
import { createAccountProfiles } from "./profile.ts";

const TTL = 10 * 60_000;
type Flow = { state: string; verifier: string; redirect: string; expires: number; generation: number };
export type AccountClient = { project: string; apiKey: string };
type ScopedSession = Pick<Session, "uid" | "idToken" | "profile"> & { generation: number; current(): boolean };

export function createAccount(deps: {
  secrets: Secrets;
  client?: AccountClient | undefined;
  google?: ClientCreds | undefined;
  origin: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  endpoints?: { googleAuth: string; googleToken: string; identity: string; secureToken: string; firestore: string };
}) {
  const now = deps.now ?? Date.now;
  const send = deps.fetch ?? fetch;
  const endpoints = deps.endpoints ?? ACCOUNT_ENDPOINTS;
  const profiles = createAccountProfiles({
    project: deps.client?.project ?? "",
    origin: endpoints.firestore,
    fetch: send,
  });
  let generation = 0;
  let flow: Flow | undefined;
  let changing = false;
  let refreshing: { generation: number; promise: Promise<Session> } | undefined;
  const stored = (): Session | undefined => {
    const raw = deps.secrets.resolve(`secret://${APX_ACCOUNT_SESSION}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as Session;
    } catch {
      return undefined;
    }
  };
  const save = (session: Session, expected: number) => {
    if (generation !== expected) throw new Error("sign_in_cancelled");
    deps.secrets.set(APX_ACCOUNT_SESSION, JSON.stringify(session));
  };
  const post = accountPost(send);
  const token = async (expected: number): Promise<Session> => {
    const session = stored();
    if (!session || !deps.client) throw new Error("sign_in_required");
    if (session.expires - 60_000 > now()) return session;
    if (refreshing?.generation === expected) return refreshing.promise;
    const pending = renewAccountSession({
      post,
      endpoint: endpoints.secureToken,
      apiKey: deps.client.apiKey,
      session,
      now,
    }).then((next) => {
      save(next, expected);
      return next;
    });
    refreshing = { generation: expected, promise: pending };
    try {
      return await pending;
    } finally {
      if (refreshing?.promise === pending) refreshing = undefined;
    }
  };
  return {
    status() {
      const session = stored();
      return { available: Boolean(deps.client && deps.google), profile: session?.profile ?? null };
    },
    start(desktop = false) {
      if (!deps.google || !deps.client) throw new Error("account_not_configured");
      if (changing) throw new Error("account_busy");
      const origin = new URL(deps.origin());
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password)
        throw new Error("account_unavailable");
      const pair = pkce();
      generation++;
      flow = {
        state: `${desktop ? "desktop." : ""}${randomBytes(32).toString("base64url")}`,
        verifier: pair.verifier,
        redirect: `${origin.origin}/oauth/account`,
        expires: now() + TTL,
        generation,
      };
      return {
        url: accountAuthUrl(endpoints.googleAuth, {
          clientId: deps.google.clientId,
          redirectUri: flow.redirect,
          state: flow.state,
          challenge: pair.challenge,
        }),
      };
    },
    async finish(code: string, state: string) {
      const current = flow;
      if (!current || current.state !== state || current.expires <= now()) throw new Error("sign_in_expired");
      if (!deps.google || !deps.client) throw new Error("account_not_configured");
      if (changing) throw new Error("account_busy");
      flow = undefined;
      changing = true;
      try {
        const session = await exchangeAccountCode({
          post,
          endpoints,
          google: deps.google,
          apiKey: deps.client.apiKey,
          code,
          flow: current,
          profiles,
          now,
        });
        save(session, current.generation);
        return { ok: true as const };
      } finally {
        changing = false;
      }
    },
    async rename(handle: string) {
      if (changing) throw new Error("account_busy");
      changing = true;
      const expected = generation;
      try {
        const session = await token(expected);
        const profile = await profiles.rename(session.uid, session.idToken, handle);
        save({ ...session, profile }, expected);
        return { profile };
      } finally {
        changing = false;
      }
    },
    async withSession<T>(work: (session: ScopedSession) => Promise<T>): Promise<T> {
      if (changing) throw new Error("account_busy");
      const expected = generation;
      const session = await token(expected);
      const current = () => generation === expected && stored()?.uid === session.uid;
      if (!current()) throw new Error("sign_in_cancelled");
      const result = await work({
        uid: session.uid,
        idToken: session.idToken,
        profile: { ...session.profile },
        generation: expected,
        current,
      });
      if (!current()) throw new Error("sign_in_cancelled");
      return result;
    },
    logout() {
      generation++;
      flow = undefined;
      deps.secrets.set(APX_ACCOUNT_SESSION, null);
      return { ok: true as const };
    },
  };
}
export type Account = ReturnType<typeof createAccount>;
