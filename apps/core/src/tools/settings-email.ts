import { EmailSignatureKey } from "@apx/protocol";
import { signatureIdentities } from "../domain/email-signature-edit.ts";
import { sameSignatureKey } from "../domain/email-signature-settings.ts";
import type { Setting } from "./settings-kit.ts";

export const EMAIL: Readonly<Record<string, Setting>> = {
  "email.signatures_get": {
    does: "List configured mailbox identities and signature keys. Pass transport/account/sender to read the full signature for editing; use that exact entry as expected, or null to create.",
    read: (p, { store }) => {
      const signatures = store.settings.read("email_signatures");
      if (!Object.keys(p).length)
        return JSON.stringify({
          identities: signatureIdentities(store),
          keys: signatures.map(({ transport, account, sender }) => ({ transport, account, sender })),
        });
      const key = EmailSignatureKey.parse(p);
      return JSON.stringify({ signature: signatures.find((entry) => sameSignatureKey(entry, key)) ?? null });
    },
  },
  "email.signature_upsert": {
    does: "Create or replace one local APX signature for a configured mailbox. expected must be the exact last-read entry, or null if absent. Does not change Gmail settings or other signatures.",
    says: () => "Change the local email signature",
    whole: true,
  },
  "email.signature_remove": {
    does: "Remove one local signature by transport/account/sender, with the exact last-read entry as expected. Other signatures stay unchanged.",
    says: () => "Remove the local email signature",
    whole: true,
  },
};
