import { randomBytes } from "node:crypto";
import type { ClientCreds } from "../integrations/google-oauth.ts";
import { pkce } from "../integrations/google-oauth.ts";
import { APX_ACCOUNT_SESSION } from "../secret-names.ts";
import type { Secrets } from "../secrets.ts";
import { ACCOUNT_ENDPOINTS, accountAuthUrl, accountExpiry, accountPost, accountText as text } from "./auth.ts";
import { type AccountProfile, createAccountProfiles } from "./profile.ts";

const TTL = 10 * 60_000;
type Session = { uid: string; idToken: string; refreshToken: string; expires: number; profile: AccountProfile };
type Flow = { state: string; verifier: string; redirect: string; expires: number; generation: number };
export type AccountClient = { project: string; apiKey: string };

export function createAccount(deps: {
  secrets: Secrets;
  client?: AccountClient | undefined;
  google?: ClientCreds | undefined;
  origin: () => string;
  /** Told once a sign-in finished, with the profile it saved. */
  onSignedIn?: (profile: AccountProfile) => void;
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
    const data = await post(
      `${endpoints.secureToken}/token?key=${encodeURIComponent(deps.client.apiKey)}`,
      {
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      },
      true,
      true,
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === "sign_in_required" && generation === expected)
        deps.secrets.set(APX_ACCOUNT_SESSION, null);
      throw error;
    });
    if (text(data, "user_id") !== session.uid) throw new Error("account_unavailable");
    const next = {
      ...session,
      idToken: text(data, "id_token"),
      refreshToken: text(data, "refresh_token"),
      expires: now() + accountExpiry(data.expires_in),
    };
    save(next, expected);
    return next;
  };
  return {
    status() {
      const session = stored();
      return {
        available: Boolean(deps.client && deps.google),
        profile: session?.profile ?? null,
        pending: Boolean(changing || (flow && flow.expires > now())),
      };
    },
    start(desktop = false) {
      if (!deps.google || !deps.client) throw new Error("account_not_configured");
      if (changing) throw new Error("account_busy");
      const origin = new URL(deps.origin());
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password)
        throw new Error("sign_in_local_only");
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
    async finish(code: string, state: string, error?: "access_denied") {
      const current = flow;
      if (!current || current.state !== state || current.expires <= now()) throw new Error("sign_in_expired");
      if (!deps.google || !deps.client) throw new Error("account_not_configured");
      if (changing) throw new Error("account_busy");
      flow = undefined;
      if (error === "access_denied") throw new Error("sign_in_cancelled");
      changing = true;
      try {
        const google = await post(
          endpoints.googleToken,
          {
            grant_type: "authorization_code",
            code,
            client_id: deps.google.clientId,
            client_secret: deps.google.clientSecret,
            redirect_uri: current.redirect,
            code_verifier: current.verifier,
          },
          true,
        );
        const identity = await post(
          `${endpoints.identity}/accounts:signInWithIdp?key=${encodeURIComponent(deps.client.apiKey)}`,
          {
            requestUri: "http://localhost",
            postBody: new URLSearchParams({
              id_token: text(google, "id_token"),
              providerId: "google.com",
            }).toString(),
            returnSecureToken: true,
          },
        );
        const uid = text(identity, "localId");
        const idToken = text(identity, "idToken");
        const profile = await profiles.ensure(
          uid,
          idToken,
          typeof identity.displayName === "string" ? identity.displayName : "",
          typeof identity.photoUrl === "string" ? identity.photoUrl : "",
        );
        if (current.expires <= now()) throw new Error("sign_in_expired");
        save(
          {
            uid,
            idToken,
            refreshToken: text(identity, "refreshToken"),
            expires: now() + accountExpiry(identity.expiresIn),
            profile,
          },
          current.generation,
        );
        deps.onSignedIn?.(profile);
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
    logout() {
      generation++;
      flow = undefined;
      deps.secrets.set(APX_ACCOUNT_SESSION, null);
      return { ok: true as const };
    },
  };
}
export type Account = ReturnType<typeof createAccount>;
