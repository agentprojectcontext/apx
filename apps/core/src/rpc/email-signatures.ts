import { editSignature } from "../domain/email-signature-edit.ts";
import { importedSignature } from "../domain/email-signature-import.ts";
import { readSignatures } from "../domain/email-signature-settings.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict } from "../errors.ts";
import { gmailApi } from "../integrations/gmail.ts";
import type { Google } from "../integrations/google.ts";
import type { Handlers } from "./router.ts";

export function emailSignatureHandlers(store: Store, google: Google) {
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
    "email.signature_import": async ({ account }) => {
      // Gmail's settings are read only with the owner's own Google client: APX's can only send.
      if (!google.connected("gmail") || google.account("gmail")?.toLowerCase() !== account.toLowerCase())
        throw badRequest("Connect this Gmail account first");
      if (!google.full("gmail")) throw badRequest("Gmail's signature can be read only with your own Google client");
      return importedSignature(await gmailApi(google).signature(account));
    },
    "email.signatures_get": () => ({ signatures: readSignatures(store) }),
    "email.signatures_set": ({ signatures }) => {
      store.settings.write("email_signatures", signatures);
      return { signatures: readSignatures(store) };
    },
  } satisfies Pick<
    Handlers,
    | "email.signatures_get"
    | "email.signatures_set"
    | "email.signature_upsert"
    | "email.signature_remove"
    | "email.signature_default_get"
    | "email.signature_default_set"
    | "email.signature_import"
  >;
}
