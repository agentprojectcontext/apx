// People and their addresses on channels. The owner is the person with role "owner" (one, created on first use);
// who someone is on a channel is decided only by an exact address match, never by a name.
import type { Address, Person, PersonRole } from "@apx/protocol";
import { newId, now, opt, type Row, type Sql } from "./sql.ts";

export const OWNER_ID = "owner";

const toAddress = (r: Row): Address => ({
  id: String(r.id),
  person_id: String(r.person_id),
  channel: String(r.channel),
  external_id: String(r.external_id),
  ...opt("label", r.label),
});

export function personsRepo({ one, all, run }: Sql) {
  const addressesOf = (id: string) =>
    all("SELECT * FROM addresses WHERE person_id = ? ORDER BY created_at", id).map(toAddress);
  const toPerson = (r: Row): Person => ({
    id: String(r.id),
    name: String(r.name),
    role: r.role as PersonRole,
    ...opt("note", r.note),
    addresses: addressesOf(String(r.id)),
    created_at: String(r.created_at),
  });
  const repo = {
    list(): Person[] {
      return all("SELECT * FROM persons ORDER BY role = 'owner' DESC, name").map(toPerson);
    },
    get(id: string): Person | undefined {
      const r = one("SELECT * FROM persons WHERE id = ?", id);
      return r ? toPerson(r) : undefined;
    },
    /** The owner as a person, created the first time it is needed. */
    owner(name = "Owner"): Person {
      if (!repo.get(OWNER_ID)) {
        const at = now();
        run(
          "INSERT INTO persons (id, name, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)",
          OWNER_ID,
          name,
          at,
          at,
        );
      }
      return repo.get(OWNER_ID) as Person;
    },
    create(p: { name: string; role: Exclude<PersonRole, "owner">; note?: string | undefined }): Person {
      const id = newId("per");
      const at = now();
      run(
        "INSERT INTO persons (id, name, role, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        p.name,
        p.role,
        p.note ?? null,
        at,
        at,
      );
      return repo.get(id) as Person;
    },
    update(id: string, p: { name?: string; role?: PersonRole; note?: string | undefined }): Person | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      // The owner's role never changes, and nobody else becomes the owner by an edit.
      const role = cur.role === "owner" ? "owner" : p.role === "owner" ? cur.role : (p.role ?? cur.role);
      run(
        "UPDATE persons SET name = ?, role = ?, note = ?, updated_at = ? WHERE id = ?",
        p.name ?? cur.name,
        role,
        p.note === undefined ? (cur.note ?? null) : p.note || null,
        now(),
        id,
      );
      return repo.get(id);
    },
    remove(id: string): boolean {
      if (id === OWNER_ID) return false;
      return Number(run("DELETE FROM persons WHERE id = ?", id).changes) > 0;
    },
    /** Who this channel address belongs to. */
    byAddress(channel: string, externalId: string): Person | undefined {
      const r = one("SELECT person_id FROM addresses WHERE channel = ? AND external_id = ?", channel, externalId);
      return r ? repo.get(String(r.person_id)) : undefined;
    },
    /** Links an address to a person; an address belongs to one person only (relinking moves it). */
    link(personId: string, a: { channel: string; external_id: string; label?: string | undefined }): Address {
      run("DELETE FROM addresses WHERE channel = ? AND external_id = ?", a.channel, a.external_id);
      const id = newId("adr");
      run(
        "INSERT INTO addresses (id, person_id, channel, external_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        personId,
        a.channel,
        a.external_id,
        a.label ?? null,
        now(),
      );
      return toAddress(one("SELECT * FROM addresses WHERE id = ?", id) as Row);
    },
    unlink(addressId: string): boolean {
      return Number(run("DELETE FROM addresses WHERE id = ?", addressId).changes) > 0;
    },
    /** The owner's address on a channel, to reach them there. */
    ownerAddress(channel: string): Address | undefined {
      const r = one(
        "SELECT * FROM addresses WHERE person_id = ? AND channel = ? ORDER BY created_at LIMIT 1",
        OWNER_ID,
        channel,
      );
      return r ? toAddress(r) : undefined;
    },
  };
  return repo;
}
