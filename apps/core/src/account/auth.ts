import { authUrl, GOOGLE } from "../integrations/google-oauth.ts";

export function accountAuthUrl(
  endpoint: string,
  params: { clientId: string; redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(authUrl({ ...GOOGLE, auth: endpoint }, { ...params, scopes: ["openid", "email", "profile"] }));
  url.searchParams.delete("access_type");
  url.searchParams.delete("include_granted_scopes");
  url.searchParams.set("prompt", "select_account");
  return url.href;
}

export function accountExpiry(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new Error("account_unavailable");
  return seconds * 1000;
}

export const ACCOUNT_ENDPOINTS = {
  googleAuth: GOOGLE.auth,
  googleToken: GOOGLE.token,
  identity: "https://identitytoolkit.googleapis.com/v1",
  secureToken: "https://securetoken.googleapis.com/v1",
  firestore: "https://firestore.googleapis.com",
};

export function accountText(data: Record<string, unknown>, key: string): string {
  if (typeof data[key] !== "string" || !data[key]) throw new Error("account_unavailable");
  return data[key];
}

/** Provider responses may contain credentials; only controlled error codes cross the handler boundary. */
export function accountPost(send: typeof fetch) {
  return async (
    url: string,
    body: Record<string, string | boolean>,
    form = false,
    refresh = false,
  ): Promise<Record<string, unknown>> => {
    try {
      const response = await send(url, {
        method: "POST",
        headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
        body: form
          ? new URLSearchParams(
              Object.entries(body).map(([key, value]): [string, string] => [key, String(value)]),
            ).toString()
          : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        if (refresh && [400, 401, 403].includes(response.status)) {
          const data = (await response.json()) as { error?: { message?: string } };
          if (
            ["TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN", "INVALID_GRANT"].includes(
              data.error?.message ?? "",
            )
          )
            throw new Error("sign_in_required");
        }
        throw new Error("account_unavailable");
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (refresh && error instanceof Error && error.message === "sign_in_required") throw error;
      throw new Error("account_unavailable");
    }
  };
}
