// People and their addresses on channels. The owner is the person with role "owner" (one, created on first use);
// who someone is on a channel is decided only by an exact address match, never by a name.
import type { Address, Person, PersonRole } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { AddressesTable, PersonsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

export const OWNER_ID = "owner";

const toAddress = (r: Selectable<AddressesTable>): Address => ({
  id: r.id,
  person_id: r.person_id,
  channel: r.channel,
  external_id: r.external_id,
  ...opt("label", r.label),
});

export function personsRepo({ one, all, run }: Sql) {
  const addressesOf = (id: string) =>
    all(qb.selectFrom("addresses").selectAll().where("person_id", "=", id).orderBy("created_at")).map(toAddress);
  const toPerson = (r: Selectable<PersonsTable>): Person => ({
    id: r.id,
    name: r.name,
    role: r.role as PersonRole,
    ...opt("note", r.note),
    addresses: addressesOf(r.id),
    created_at: r.created_at,
  });
  const repo = {
    list(): Person[] {
      return all(
        qb
          .selectFrom("persons")
          .selectAll()
          .orderBy((eb) => eb("role", "=", "owner"), "desc")
          .orderBy("name"),
      ).map(toPerson);
    },
    get(id: string): Person | undefined {
      const r = one(qb.selectFrom("persons").selectAll().where("id", "=", id));
      return r ? toPerson(r) : undefined;
    },
    /** The owner as a person, created the first time it is needed. */
    owner(name = "Owner"): Person {
      if (!repo.get(OWNER_ID)) {
        const at = now();
        run(qb.insertInto("persons").values({ id: OWNER_ID, name, role: "owner", created_at: at, updated_at: at }));
      }
      return repo.get(OWNER_ID) as Person;
    },
    create(p: { name: string; role: Exclude<PersonRole, "owner">; note?: string | undefined }): Person {
      const id = newId("per");
      const at = now();
      run(
        qb
          .insertInto("persons")
          .values({ id, name: p.name, role: p.role, note: p.note ?? null, created_at: at, updated_at: at }),
      );
      return repo.get(id) as Person;
    },
    update(id: string, p: { name?: string; role?: PersonRole; note?: string | undefined }): Person | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      // The owner's role never changes, and nobody else becomes the owner by an edit.
      const role = cur.role === "owner" ? "owner" : p.role === "owner" ? cur.role : (p.role ?? cur.role);
      run(
        qb
          .updateTable("persons")
          .set({
            name: p.name ?? cur.name,
            role,
            note: p.note === undefined ? (cur.note ?? null) : p.note || null,
            updated_at: now(),
          })
          .where("id", "=", id),
      );
      return repo.get(id);
    },
    remove(id: string): boolean {
      if (id === OWNER_ID) return false;
      return run(qb.deleteFrom("persons").where("id", "=", id)) > 0;
    },
    /** Who this channel address belongs to. */
    byAddress(channel: string, externalId: string): Person | undefined {
      const r = one(
        qb
          .selectFrom("addresses")
          .select("person_id")
          .where("channel", "=", channel)
          .where("external_id", "=", externalId),
      );
      return r ? repo.get(r.person_id) : undefined;
    },
    /** Links an address to a person; an address belongs to one person only (relinking moves it). */
    link(personId: string, a: { channel: string; external_id: string; label?: string | undefined }): Address {
      run(qb.deleteFrom("addresses").where("channel", "=", a.channel).where("external_id", "=", a.external_id));
      const id = newId("adr");
      run(
        qb.insertInto("addresses").values({
          id,
          person_id: personId,
          channel: a.channel,
          external_id: a.external_id,
          label: a.label ?? null,
          created_at: now(),
        }),
      );
      return toAddress(one(qb.selectFrom("addresses").selectAll().where("id", "=", id)) as Selectable<AddressesTable>);
    },
    unlink(addressId: string): boolean {
      return run(qb.deleteFrom("addresses").where("id", "=", addressId)) > 0;
    },
    /** The owner's address on a channel, to reach them there. */
    ownerAddress(channel: string): Address | undefined {
      const r = one(
        qb
          .selectFrom("addresses")
          .selectAll()
          .where("person_id", "=", OWNER_ID)
          .where("channel", "=", channel)
          .orderBy("created_at")
          .limit(1),
      );
      return r ? toAddress(r) : undefined;
    },
  };
  return repo;
}
