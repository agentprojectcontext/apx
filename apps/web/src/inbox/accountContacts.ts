import type { Person, Thread } from "@apx/protocol";

/**
 * The saved contacts of one channel account who have no chat there yet (archived chats count as one), by name: an
 * account's list shows them after its chats, so everyone it can reach is there. `query` matches name or nickname.
 */
export function contactsWithoutChat(
  persons: readonly Person[],
  threads: Record<string, Thread>,
  accountId: string,
  query = "",
): Person[] {
  const talked = new Set<string>();
  for (const th of Object.values(threads))
    if (th.channel?.id === accountId && th.channel.person_id) talked.add(th.channel.person_id);
  const q = query.trim().toLowerCase();
  return persons
    .filter(
      (p) =>
        p.role === "contact" &&
        !talked.has(p.id) &&
        p.addresses.some((a) => a.channel === accountId) &&
        (!q || `${p.name} ${p.nickname ?? ""}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
