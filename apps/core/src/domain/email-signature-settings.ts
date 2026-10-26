import type { EmailSignatureEntry } from "@apx/protocol";
import type { Store } from "./store.ts";

export function signatureFor(
  store: Pick<Store, "settings">,
  transport: EmailSignatureEntry["transport"],
  account: string | undefined,
  sender: string | undefined,
): EmailSignatureEntry | undefined {
  if (!account || !sender) return undefined;
  return store.settings
    .read("email_signatures")
    .find(
      (entry) =>
        entry.enabled &&
        entry.transport === transport &&
        (transport === "gmail" ? entry.account.toLowerCase() === account.toLowerCase() : entry.account === account) &&
        entry.sender.toLowerCase() === sender.toLowerCase(),
    );
}
