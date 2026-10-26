import { type EmailSignatureEntry, EmailSignatures } from "@apx/protocol";
import { badRequest, conflict } from "../errors.ts";
import { sameSignatureKey } from "./email-signature-settings.ts";
import type { Store } from "./store.ts";

type Key = Pick<EmailSignatureEntry, "transport" | "account" | "sender">;

export function signatureIdentities(store: Store): Key[] {
  const gmail = store.settings.get("google_account:gmail");
  return [
    ...(gmail ? [{ transport: "gmail" as const, account: gmail, sender: gmail }] : []),
    ...store.settings
      .read("channels")
      .flatMap((c) =>
        c.type === "email" && c.email ? [{ transport: "smtp" as const, account: c.id, sender: c.email.address }] : [],
      ),
  ];
}

/** Synchronous read/compare/write keeps approval snapshots from overwriting a later edit. */
export function editSignature(
  store: Store,
  key: Key,
  expected: EmailSignatureEntry | null,
  next: EmailSignatureEntry | null,
): void {
  if (!signatureIdentities(store).some((id) => sameSignatureKey(id, key)))
    throw badRequest("Signature must match a configured Gmail account or SMTP mailbox sender");
  const entries = store.settings.read("email_signatures");
  const current = entries.find((entry) => sameSignatureKey(entry, key)) ?? null;
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw conflict("Signature changed: read it again before approving another edit");
  const others = entries.filter((entry) => !sameSignatureKey(entry, key));
  const signatures = EmailSignatures.safeParse(next ? [...others, next] : others);
  if (!signatures.success) throw badRequest("Signature limit exceeded or invalid signature list");
  store.settings.write("email_signatures", signatures.data);
}
