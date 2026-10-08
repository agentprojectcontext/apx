// The owner's Google account for Calendar and Gmail: their OAuth client (the id in settings, the secret in the secret
// store), one refresh token per integration (a secret), and authenticated calls to Google's REST APIs. Google sends
// the browser back to the panel (/oauth/google), which hands the code to `integrations.oauth_finish`: no route of its
// own in the core.
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

export type Google = ReturnType<typeof createGoogle>;

export function createGoogle(deps: {
  store: Store;
  secrets: Secrets;
  endpoints: GoogleEndpoints;
  /** This core's own loopback address (the port it listens on). */
  origin: () => string;
  /** Whether the owner turned an integration off in a project. */
  offIn: (project: string, id: GoogleId) => boolean;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const { store, secrets, endpoints } = deps;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const signer = stateSigner(FLOW_TTL_MS, now);
  /** Sign-ins under way, by their nonce: each finishes once. */
  const flows = new Map<string, { id: GoogleId; verifier: string; redirect: string; exp: number }>();
  const access = new Map<GoogleId, { token: string; exp: number }>();

  const creds = (): ClientCreds | undefined => {
    const clientId = store.settings.get(CLIENT_ID);
    const clientSecret = secrets.resolve(`secret://${CLIENT_SECRET}`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const refreshToken = (id: GoogleId) => secrets.resolve(`secret://${refreshName(id)}`);
  const redirectUri = () => `${deps.origin().replace(/\/$/, "")}${OAUTH_PATH}`;

  const g = {
    endpoints,
    redirectUri,
    /** The OAuth client as the panel may see it: the id, and only whether a secret is stored. */
    client(): { client_id: string | undefined; secret: boolean } {
      return {
        client_id: store.settings.get(CLIENT_ID) || undefined,
        secret: secrets.has(`secret://${CLIENT_SECRET}`),
      };
    },
    connected: (id: GoogleId) => refreshToken(id) !== undefined,
    account: (id: GoogleId) => store.settings.get(accountKey(id)) || undefined,
    /** Its tools are offered in a thread: connected, and not turned off in the thread's project. */
    usable: (id: GoogleId, project: string | undefined) => g.connected(id) && !(project && deps.offIn(project, id)),

    /** Saves the client (what is typed; empty keeps what is stored) and gives the consent URL for one integration. */
    start(id: GoogleId, values: { client_id?: string | undefined; client_secret?: string | undefined }): string {
      const typedId = values.client_id?.trim();
      const typedSecret = values.client_secret?.trim();
      if (typedId) store.settings.set(CLIENT_ID, typedId);
      if (typedSecret) secrets.set(CLIENT_SECRET, typedSecret);
      const c = creds();
      if (!c) throw new Error("Google needs the client id and the client secret of your OAuth client");
      for (const [k, f] of flows) if (f.exp < now()) flows.delete(k);
      const nonce = randomUUID();
      const { verifier, challenge } = pkce();
      const redirect = redirectUri();
      flows.set(nonce, { id, verifier, redirect, exp: now() + FLOW_TTL_MS });
      const scopes = ["openid", "email", ...(GOOGLE_INTEGRATIONS.find((x) => x.id === id)?.scopes ?? [])];
      return authUrl(endpoints, {
        clientId: c.clientId,
        redirectUri: redirect,
        scopes,
        state: signer.sign({ id, nonce }),
        challenge,
      });
    },

    /** The code Google sent back: a state this core signed in the last minutes, used once. */
    async finish(code: string, state: string): Promise<{ id: GoogleId; account: string | undefined }> {
      const data = signer.verify(state);
      const flow = data?.nonce ? flows.get(data.nonce) : undefined;
      if (!data || !flow || flow.id !== data.id || flow.exp < now())
        throw new Error("this sign-in link is not valid or expired; start it again from APX");
      flows.delete(data.nonce ?? "");
      const c = creds();
      if (!c) throw new Error("the Google client is gone; enter it again");
      const got = await exchangeCode(
        endpoints,
        { ...c, code, redirectUri: flow.redirect, verifier: flow.verifier },
        fetchImpl,
      );
      secrets.set(refreshName(flow.id), got.refreshToken);
      store.settings.set(accountKey(flow.id), got.email ?? "");
      access.delete(flow.id);
      if (got.accessToken) access.set(flow.id, { token: got.accessToken, exp: now() + got.expiresIn * 1000 });
      return { id: flow.id, account: got.email };
    },

    /** Forgets one integration's sign-in; the client goes too once no Google integration is left. */
    disconnect(id: GoogleId): void {
      secrets.set(refreshName(id), null);
      store.settings.set(accountKey(id), "");
      access.delete(id);
      if (!GOOGLE_INTEGRATIONS.some((x) => g.connected(x.id))) {
        secrets.set(CLIENT_SECRET, null);
        store.settings.set(CLIENT_ID, "");
      }
    },

    /** An access token for an integration, minted from its refresh token when the cached one is near its end. */
    async token(id: GoogleId): Promise<string> {
      const hit = access.get(id);
      if (hit && hit.exp - 60_000 > now()) return hit.token;
      const c = creds();
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

    /** A JSON call to one of Google's APIs as the owner; a refused token is minted again once. */
    async call<T>(
      id: GoogleId,
      url: string,
      o: { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
    ): Promise<T> {
      const u = new URL(url);
      for (const [k, v] of Object.entries(o.query ?? {}))
        if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
      const send = async () =>
        fetchImpl(u, {
          method: o.method ?? "GET",
          headers: {
            authorization: `Bearer ${await g.token(id)}`,
            ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
      let res = await send();
      if (res.status === 401) {
        access.delete(id);
        res = await send();
      }
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(`${labelOf(id)}: ${data.error?.message ?? `HTTP ${res.status}`}`);
      return data as T;
    },
  };
  return g;
}

const labelOf = (id: GoogleId) => GOOGLE_INTEGRATIONS.find((x) => x.id === id)?.label ?? id;
