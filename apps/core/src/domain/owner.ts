// Who the owner is, for their agents: the name is the owner's person, the rest are settings. Agents read it in their
// system prompt (name, about) and their turn context (language, time zone).
import type { OwnerIdentity } from "@apx/protocol";
import type { Store } from "./store.ts";

export function ownerIdentity(store: Store): OwnerIdentity {
  const extra = store.settings.read("owner_profile");
  return {
    name: store.persons.owner().name === "Owner" ? "" : store.persons.owner().name,
    about: extra.about,
    call_me: extra.call_me ?? "",
    language: store.settings.get("owner_language") || "es",
    timezone: extra.timezone,
    publish: extra.publish ?? "auto",
  };
}

export function saveOwnerIdentity(store: Store, patch: Partial<OwnerIdentity>): OwnerIdentity {
  const name = patch.name?.trim();
  if (name) store.persons.update(store.persons.owner().id, { name });
  if (patch.language !== undefined) store.settings.set("owner_language", patch.language);
  if (
    patch.about !== undefined ||
    patch.call_me !== undefined ||
    patch.timezone !== undefined ||
    patch.publish !== undefined
  ) {
    const cur = store.settings.read("owner_profile");
    store.settings.write("owner_profile", {
      about: patch.about ?? cur.about,
      call_me: patch.call_me?.trim() ?? cur.call_me,
      timezone: patch.timezone ?? cur.timezone,
      publish: patch.publish ?? cur.publish,
    });
  }
  return ownerIdentity(store);
}

/**
 * Signing in to the APX account names the owner only while they have no name of their own (the panel says "You"); a
 * name they typed is never replaced here (the panel asks them first). See DECISIONS.md#d-247.
 */
export function adoptAccountName(store: Store, name: string): boolean {
  const given = name.trim();
  if (!given || ownerIdentity(store).name) return false;
  saveOwnerIdentity(store, { name: given });
  return true;
}

/** The owner's time zone when it is a real one; undefined: this machine's. */
export function ownerTimeZone(store: Store): string | undefined {
  const tz = store.settings.read("owner_profile").timezone;
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
