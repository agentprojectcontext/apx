import { editSignature } from "../domain/email-signature-edit.ts";
import type { Store } from "../domain/store.ts";
import { conflict } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function emailSignatureHandlers(store: Store) {
  return {
    "email.signature_default_get": () => ({ signature: store.settings.read("email_signature_default") }),
    "email.signature_default_set": ({ signature, expected }) => {
      const current = store.settings.read("email_signature_default");
      if (JSON.stringify(current) !== JSON.stringify(expected))
        throw conflict("Default signature changed: read it again before approving another edit");
      store.settings.write("email_signature_default", signature);
      return { signature };
    },
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
    | "email.signatures_get"
    | "email.signatures_set"
    | "email.signature_upsert"
    | "email.signature_remove"
    | "email.signature_default_get"
    | "email.signature_default_set"
  >;
}
