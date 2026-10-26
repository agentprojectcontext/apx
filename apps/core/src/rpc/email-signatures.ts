import { editSignature } from "../domain/email-signature-edit.ts";
import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function emailSignatureHandlers(store: Store) {
  return {
    "email.signature_upsert": ({ signature, expected }) => {
      editSignature(store, signature, expected, signature);
      return { signature };
    },
    "email.signature_remove": ({ key, expected }) => {
      editSignature(store, key, expected, null);
      return { removed: true };
    },
    "email.signatures_get": () => ({ signatures: store.settings.read("email_signatures") }),
    "email.signatures_set": ({ signatures }) => {
      store.settings.write("email_signatures", signatures);
      return { signatures: store.settings.read("email_signatures") };
    },
  } satisfies Pick<
    Handlers,
    "email.signatures_get" | "email.signatures_set" | "email.signature_upsert" | "email.signature_remove"
  >;
}
