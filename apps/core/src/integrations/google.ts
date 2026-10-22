// The owner's Google account for Calendar, Gmail and Drive: the OAuth client (APX's own, or the owner's with the id in
// settings and the secret in the secret store), one refresh token per integration (a secret), and authenticated calls
// to Google's REST APIs. Google sends the browser back to the panel (/oauth/google), which hands the code to
// `integrations.oauth_finish`: no route of its own in the core.
import { randomUUID } from "node:crypto";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";
import { GOOGLE_INTEGRATIONS, type GoogleId } from "./catalog.ts";
import {
  authUrl,
  type ClientCreds,
  exchangeCode,
  GoogleAuthError,
  type GoogleEndpoints,
  pkce,
  refreshAccess,
  stateSigner,
} from "./google-oauth.ts";

/** The panel route Google redirects to: the one address the owner registers in Cloud Console. */
export const OAUTH_PATH = "/oauth/google";
const FLOW_TTL_MS = 10 * 60_000;

const CLIENT_ID = "google_client_id";
const CLIENT_SECRET = "google-client_secret";
const refreshName = (id: GoogleId) => `${id}-refresh_token`;
const accountKey = (id: GoogleId) => `google_account:${id}`;
/** Which client signed an integration in: its refresh token works only with that one. */
const clientKey = (id: GoogleId) => `google_client:${id}`;

/** APX's own client, or the one the owner made in Cloud Console. */
export type ClientKind = "apx" | "own";

export type Google = ReturnType<typeof createGoogle>;

export function createGoogle(deps: {
  store: Store;
  secrets: Secrets;
  endpoints: GoogleEndpoints;
  /** This core's own loopback address (the port it listens on). */
  origin: () => string;
  /** Whether the owner turned an integration off in a project. */
  offIn: (project: string, id: GoogleId) => boolean;
  /** The client this build ships (google-client.ts), when it has one. */
  builtin?: ClientCreds | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const { store, secrets, endpoints } = deps;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const signer = stateSigner(FLOW_TTL_MS, now);
  /** Sign-ins under way, by their nonce: each finishes once. */
  const flows = new Map<
    string,
    { id: GoogleId; also: GoogleId[]; kind: ClientKind; verifier: string; redirect: string; exp: number }
  >();
  const access = new Map<GoogleId, { token: string; exp: number }>();

  const own = (): ClientCreds | undefined => {
    const clientId = store.settings.get(CLIENT_ID);
    const clientSecret = secrets.resolve(`secret://${CLIENT_SECRET}`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const creds = (kind: ClientKind) => (kind === "apx" ? deps.builtin : own());
  // Signed in before APX shipped a client: it was the owner's.
  const kindOf = (id: GoogleId): ClientKind => (store.settings.get(clientKey(id)) === "apx" ? "apx" : "own");
  const refreshToken = (id: GoogleId) => secrets.resolve(`secret://${refreshName(id)}`);
  const redirectUri = () => `${deps.origin().replace(/\/$/, "")}${OAUTH_PATH}`;

  const g = {
    endpoints,
    redirectUri,
    /**
     * The owner's OAuth client as the panel may see it (the id, and only whether a secret is stored), and whether
     * this build ships APX's own.
     */
    client(): { client_id: string | undefined; secret: boolean; builtin: boolean } {
      return {
        client_id: store.settings.get(CLIENT_ID) || undefined,
        secret: secrets.has(`secret://${CLIENT_SECRET}`),
        builtin: Boolean(deps.builtin),
      };
    },
    /** The client an integration is signed in with, while it is connected. */
    clientOf: (id: GoogleId): ClientKind | undefined => (g.connected(id) ? kindOf(id) : undefined),
    connected: (id: GoogleId) => refreshToken(id) !== undefined,
    account: (id: GoogleId) => store.settings.get(accountKey(id)) || undefined,
    /** Its tools are offered in a thread: connected, and not turned off in the thread's project. */
    usable: (id: GoogleId, project: string | undefined) => g.connected(id) && !(project && deps.offIn(project, id)),
    /** Signed in with the owner's own client: every scope (reading all mail and all of Drive), not APX's narrower set. */
    full: (id: GoogleId) => g.clientOf(id) === "own",

    /**
     * The consent URL for one integration, and for `also` in the same consent (one sign-in, one refresh token kept
     * for each). `client` "own" saves the owner's client (what is typed; empty keeps what is stored); without it,
     * APX's own client is used when this build has one and nothing was typed.
     */
    start(
      id: GoogleId,
      values: { client?: string | undefined; client_id?: string | undefined; client_secret?: string | undefined },
      also: GoogleId[] = [],
    ): string {
      const typedId = values.client_id?.trim();
      const typedSecret = values.client_secret?.trim();
      const kind: ClientKind =
        values.client === "apx" || values.client === "own"
          ? values.client
          : deps.builtin && !typedId && !typedSecret
            ? "apx"
            : "own";
      if (kind === "own") {
        if (typedId) store.settings.set(CLIENT_ID, typedId);
        if (typedSecret) secrets.set(CLIENT_SECRET, typedSecret);
      }
      const c = creds(kind);
      if (!c)
        throw new Error(
          kind === "apx"
            ? "this APX build has no Google client of its own; use your own OAuth client"
            : "Google needs the client id and the client secret of your OAuth client",
        );
      for (const [k, f] of flows) if (f.exp < now()) flows.delete(k);
      const nonce = randomUUID();
      const { verifier, challenge } = pkce();
      const redirect = redirectUri();
      const more = [...new Set(also)].filter((x) => x !== id);
      flows.set(nonce, { id, also: more, kind, verifier, redirect, exp: now() + FLOW_TTL_MS });
      const wanted = GOOGLE_INTEGRATIONS.filter((x) => x.id === id || more.includes(x.id));
      const scopes = ["openid", "email", ...wanted.flatMap((e) => (kind === "apx" ? e.apxScopes : e.scopes))];
      return authUrl(endpoints, {
        clientId: c.clientId,
        redirectUri: redirect,
        scopes,
        state: signer.sign({ id, nonce }),
        challenge,
      });
    },

    /** The code Google sent back: a state this core signed in the last minutes, used once. */
    async finish(
      code: string,
      state: string,
    ): Promise<{ id: GoogleId; also: GoogleId[]; account: string | undefined }> {
      const data = signer.verify(state);
      const flow = data?.nonce ? flows.get(data.nonce) : undefined;
      if (!data || !flow || flow.id !== data.id || flow.exp < now())
        throw new Error("this sign-in link is not valid or expired; start it again from APX");
      flows.delete(data.nonce ?? "");
      const c = creds(flow.kind);
      if (!c) throw new Error("the Google client is gone; enter it again");
      const got = await exchangeCode(
        endpoints,
        { ...c, code, redirectUri: flow.redirect, verifier: flow.verifier },
        fetchImpl,
      );
      for (const id of [flow.id, ...flow.also]) {
        secrets.set(refreshName(id), got.refreshToken);
        store.settings.set(accountKey(id), got.email ?? "");
        store.settings.set(clientKey(id), flow.kind);
        access.delete(id);
        if (got.accessToken) access.set(id, { token: got.accessToken, exp: now() + got.expiresIn * 1000 });
      }
      return { id: flow.id, also: flow.also, account: got.email };
    },

    /** Forgets one integration's sign-in; the owner's client goes too once no integration signs in with it. */
    disconnect(id: GoogleId): void {
      secrets.set(refreshName(id), null);
      store.settings.set(accountKey(id), "");
      store.settings.set(clientKey(id), "");
      access.delete(id);
      if (!GOOGLE_INTEGRATIONS.some((x) => g.clientOf(x.id) === "own")) {
        secrets.set(CLIENT_SECRET, null);
        store.settings.set(CLIENT_ID, "");
      }
    },

    /** An access token for an integration, minted from its refresh token when the cached one is near its end. */
    async token(id: GoogleId): Promise<string> {
      const hit = access.get(id);
      if (hit && hit.exp - 60_000 > now()) return hit.token;
      const c = creds(kindOf(id));
      const rt = refreshToken(id);
      if (!c || !rt) throw new Error(`${labelOf(id)} is not connected; connect it in Resources › Integrations`);
      try {
        const got = await refreshAccess(endpoints, { ...c, refreshToken: rt }, fetchImpl);
        access.set(id, { token: got.accessToken, exp: now() + got.expiresIn * 1000 });
        return got.accessToken;
      } catch (e) {
        if (e instanceof GoogleAuthError && e.code === "invalid_grant")
          throw new Error(`Google no longer accepts the sign-in of ${labelOf(id)}; sign in again in Integrations`);
        throw e;
      }
    },

    /**
     * A call to one of Google's APIs as the owner: a JSON body, or `raw` as is (an upload); the answer as JSON, or
     * as text with `text`. A refused token is minted again once.
     */
    async call<T>(
      id: GoogleId,
      url: string,
      o: {
        method?: string;
        query?: Record<string, string | number | boolean | undefined>;
        body?: unknown;
        raw?: { type: string; data: string };
        text?: boolean;
      } = {},
    ): Promise<T> {
      const u = new URL(url);
      for (const [k, v] of Object.entries(o.query ?? {}))
        if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
      const payload = o.raw
        ? { type: o.raw.type, data: o.raw.data }
        : o.body !== undefined
          ? { type: "application/json", data: JSON.stringify(o.body) }
          : undefined;
      const send = async () =>
        fetchImpl(u, {
          method: o.method ?? "GET",
          headers: {
            authorization: `Bearer ${await g.token(id)}`,
            ...(payload ? { "content-type": payload.type } : {}),
          },
          ...(payload ? { body: payload.data } : {}),
          signal: AbortSignal.timeout(30_000),
        });
      let res = await send();
      if (res.status === 401) {
        access.delete(id);
        res = await send();
      }
      if (res.ok && o.text) return (await res.text()) as T;
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(`${labelOf(id)}: ${data.error?.message ?? `HTTP ${res.status}`}`);
      return data as T;
    },
  };
  return g;
}

const labelOf = (id: GoogleId) => GOOGLE_INTEGRATIONS.find((x) => x.id === id)?.label ?? id;
