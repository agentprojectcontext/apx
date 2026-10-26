import type { Store } from "../domain/store.ts";
import type { Handlers } from "./router.ts";

export function emailSignatureHandlers(store: Store) {
  return {
    "email.signatures_get": () => ({ signatures: store.settings.read("email_signatures") }),
    "email.signatures_set": ({ signatures }) => {
      store.settings.write("email_signatures", signatures);
      return { signatures: store.settings.read("email_signatures") };
    },
  } satisfies Pick<Handlers, "email.signatures_get" | "email.signatures_set">;
}
