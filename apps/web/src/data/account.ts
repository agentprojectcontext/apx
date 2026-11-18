import type { T } from "../i18n/index.ts";
import { createStore } from "./createStore.ts";

export const accountReturnState = createStore<{ revision: number; error: string }>({ revision: 0, error: "" });

export function accountError(t: T, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "invalid_handle") return t("account.handleInvalid");
  if (message === "handle_unavailable") return t("account.handleUnavailable");
  if (message === "account_not_configured") return t("account.unavailable");
  if (message === "sign_in_expired") return t("account.expired");
  if (message === "sign_in_cancelled" || message === "access_denied") return t("account.cancelled");
  if (message === "sign_in_required") return t("account.required");
  if (message === "account_busy") return t("account.busy");
  if (message === "account_access_denied") return t("account.denied");
  if (
    message === "sign_in_local_only" ||
    message === "account.start requires a direct local connection" ||
    message === "account.finish requires a direct local connection"
  )
    return t("account.localOnly");
  return t("account.failed");
}

/** A native wake-up refreshes the account; the browser has already finished signing in. */
export function listenAccountReturn(openAccount: () => void): () => void {
  const desktop = window.apxDesktop;
  if (!desktop?.takeAccountReturn) return () => {};
  const take = async () => {
    const value = await desktop.takeAccountReturn?.();
    if (!value) return;
    accountReturnState.set((s) => ({ revision: s.revision + 1, error: "" }));
    openAccount();
  };
  const receive = () => {
    void take().catch(() => {});
  };
  const off = desktop.onAccountReturn?.(receive);
  receive();
  return () => off?.();
}
