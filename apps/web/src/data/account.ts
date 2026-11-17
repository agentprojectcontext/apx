import type { T } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore } from "./createStore.ts";

export const accountReturnState = createStore<{ revision: number; error: string }>({ revision: 0, error: "" });

export function accountError(t: T, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "invalid_handle") return t("account.handleInvalid");
  if (message === "handle_unavailable") return t("account.handleUnavailable");
  if (message === "account_not_configured") return t("account.unavailable");
  if (message === "sign_in_expired" || message === "sign_in_cancelled") return t("account.expired");
  return t("account.failed");
}

/** The main panel takes a native callback once; secrets stay behind the core's protocol boundary. */
export function listenAccountReturn(openAccount: () => void): () => void {
  const desktop = window.apxDesktop;
  if (!desktop?.takeAccountReturn) return () => {};
  const take = async () => {
    const value = await desktop.takeAccountReturn?.();
    if (!value) return;
    try {
      await client.call("account.finish", value);
      accountReturnState.set((s) => ({ revision: s.revision + 1, error: "" }));
    } catch (error) {
      accountReturnState.set((s) => ({
        revision: s.revision + 1,
        error: error instanceof Error ? error.message : "account_unavailable",
      }));
    }
    openAccount();
  };
  const receive = () => {
    void take().catch(() => {});
  };
  const off = desktop.onAccountReturn?.(receive);
  receive();
  return () => off?.();
}
