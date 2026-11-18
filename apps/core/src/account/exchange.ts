import type { ClientCreds } from "../integrations/google-oauth.ts";
import { accountExpiry, type accountPost, accountText as text } from "./auth.ts";
import type { AccountProfile, createAccountProfiles } from "./profile.ts";

export type AccountSession = {
  uid: string;
  idToken: string;
  refreshToken: string;
  expires: number;
  profile: AccountProfile;
};

type Post = ReturnType<typeof accountPost>;

export async function exchangeAccountCode(deps: {
  post: Post;
  endpoints: { googleToken: string; identity: string };
  google: ClientCreds;
  apiKey: string;
  code: string;
  flow: { redirect: string; verifier: string; expires: number };
  profiles: ReturnType<typeof createAccountProfiles>;
  now(): number;
}): Promise<AccountSession> {
  const google = await deps.post(
    deps.endpoints.googleToken,
    {
      grant_type: "authorization_code",
      code: deps.code,
      client_id: deps.google.clientId,
      client_secret: deps.google.clientSecret,
      redirect_uri: deps.flow.redirect,
      code_verifier: deps.flow.verifier,
    },
    true,
  );
  const identity = await deps.post(
    `${deps.endpoints.identity}/accounts:signInWithIdp?key=${encodeURIComponent(deps.apiKey)}`,
    {
      requestUri: "http://localhost",
      postBody: new URLSearchParams({ id_token: text(google, "id_token"), providerId: "google.com" }).toString(),
      returnSecureToken: true,
    },
  );
  const uid = text(identity, "localId");
  const idToken = text(identity, "idToken");
  const profile = await deps.profiles.ensure(
    uid,
    idToken,
    typeof identity.displayName === "string" ? identity.displayName : "",
    typeof identity.photoUrl === "string" ? identity.photoUrl : "",
  );
  if (deps.flow.expires <= deps.now()) throw new Error("sign_in_expired");
  return {
    uid,
    idToken,
    refreshToken: text(identity, "refreshToken"),
    expires: deps.now() + accountExpiry(identity.expiresIn),
    profile,
  };
}

export async function renewAccountSession(deps: {
  post: Post;
  endpoint: string;
  apiKey: string;
  session: AccountSession;
  now(): number;
}): Promise<AccountSession> {
  const data = await deps.post(
    `${deps.endpoint}/token?key=${encodeURIComponent(deps.apiKey)}`,
    { grant_type: "refresh_token", refresh_token: deps.session.refreshToken },
    true,
  );
  if (text(data, "user_id") !== deps.session.uid) throw new Error("account_unavailable");
  return {
    ...deps.session,
    idToken: text(data, "id_token"),
    refreshToken: text(data, "refresh_token"),
    expires: deps.now() + accountExpiry(data.expires_in),
  };
}
