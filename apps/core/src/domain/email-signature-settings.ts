import type { EmailSignatureEntry, EmailSignatureValue } from "@apx/protocol";
import type { Store } from "./store.ts";

type Key = Pick<EmailSignatureEntry, "transport" | "account" | "sender">;

export function sameSignatureKey(a: Key, b: Key): boolean {
  return (
    a.transport === b.transport &&
    a.sender.toLowerCase() === b.sender.toLowerCase() &&
    (a.transport === "gmail" ? a.account.toLowerCase() === b.account.toLowerCase() : a.account === b.account)
  );
}

export function signatureFor(
  store: Pick<Store, "settings">,
  transport: EmailSignatureEntry["transport"],
  account: string | undefined,
  sender: string | undefined,
): EmailSignatureValue | undefined {
  if (!account || !sender) return undefined;
  const specific = store.settings
    .read("email_signatures")
    .find((entry) => sameSignatureKey(entry, { transport, account, sender }));
  if (specific) return specific.enabled ? specific : undefined;
  const fallback = store.settings.read("email_signature_default");
  return fallback?.enabled ? fallback : undefined;
}
