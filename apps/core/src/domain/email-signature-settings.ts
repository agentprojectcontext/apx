import { type EmailSignatureEntry, EmailSignatures, type EmailSignatureValue } from "@apx/protocol";
import { conflict } from "../errors.ts";
import type { Store } from "./store.ts";

type Key = Pick<EmailSignatureEntry, "transport" | "account" | "sender">;

export function sameSignatureKey(a: Key, b: Key): boolean {
  return (
    a.transport === b.transport &&
    a.sender.toLowerCase() === b.sender.toLowerCase() &&
    (a.transport === "gmail" ? a.account.toLowerCase() === b.account.toLowerCase() : a.account === b.account)
  );
}

function storedSignatures(store: Pick<Store, "settings">): EmailSignatureEntry[] | undefined {
  const raw = store.settings.get("email_signatures");
  if (raw === undefined) return [];
  try {
    const parsed = EmailSignatures.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function readSignatures(store: Pick<Store, "settings">): EmailSignatureEntry[] {
  const entries = storedSignatures(store);
  if (!entries)
    throw conflict(
      "Stored email signatures are invalid; restore them or explicitly replace the complete signature list before editing",
    );
  return entries;
}

export function signatureFor(
  store: Pick<Store, "settings">,
  transport: EmailSignatureEntry["transport"],
  account: string | undefined,
  sender: string | undefined,
): EmailSignatureValue | undefined {
  if (!account || !sender) return undefined;
  const entries = storedSignatures(store);
  // Invalid overrides may hide an explicit opt-out, so they must block the fallback.
  if (!entries) return undefined;
  const specific = entries.find((entry) => sameSignatureKey(entry, { transport, account, sender }));
  if (specific) return specific.enabled ? specific : undefined;
  const fallback = store.settings.read("email_signature_default");
  return fallback?.enabled ? fallback : undefined;
}
