import type { Account } from "../account/session.ts";
import { badRequest } from "../errors.ts";
import type { Handlers } from "./router.ts";

/** Controlled codes only: provider responses and session material never reach RPC errors or logs. */
async function result<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw badRequest(
      [
        "invalid_handle",
        "handle_unavailable",
        "account_unavailable",
        "account_access_denied",
        "sign_in_cancelled",
        "sign_in_required",
        "sign_in_expired",
        "account_not_configured",
        "account_busy",
        "sign_in_local_only",
        "session_not_saved",
      ].includes(code)
        ? code
        : "account_unavailable",
    );
  }
}

export function accountHandlers(account: Account) {
  return {
    "account.get": () => result(() => account.status()),
    "account.start": ({ desktop }) => result(() => account.start(desktop)),
    "account.finish": (params) =>
      result(() =>
        account.finish("code" in params ? params.code : "", params.state, "error" in params ? params.error : undefined),
      ),
    "account.rename": ({ handle }) => result(() => account.rename(handle)),
    "account.logout": () => result(() => account.logout()),
  } satisfies Partial<Handlers>;
}
