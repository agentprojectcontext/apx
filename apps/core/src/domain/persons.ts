// People and their addresses on channels. The owner is the person with role "owner" (one, created on first use);
// who someone is on a channel is decided only by an exact address match, never by a name.
import { type Address, type Person, PersonPerms, PersonRelation, type PersonRole } from "@apx/protocol";
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

/** Stored flags, anything unreadable meaning "off". */
function permsOf(text: string | null): PersonPerms {
  try {
    return PersonPerms.parse(JSON.parse(text ?? "{}"));
  } catch {
    return { appointments: false, requests: false, notes: false };
  }
}

/** What the owner may change about a person besides name and role. */
export type PersonDetails = {
  note?: string | undefined;
  nickname?: string | undefined;
  relation?: PersonRelation | null | undefined;
  rules?: string | undefined;
  muted?: boolean | undefined;
  supervised?: boolean | undefined;
  any_hour?: boolean | undefined;
  perms?: Partial<PersonPerms> | undefined;
};

export function personsRepo({ one, all, run, tx }: Sql) {
  const addressesOf = (id: string) =>
    all(qb.selectFrom("addresses").selectAll().where("person_id", "=", id).orderBy("created_at")).map(toAddress);
  const toPerson = (r: Selectable<PersonsTable>): Person => {
    const relation = PersonRelation.safeParse(r.relation);
    return {
      id: r.id,
      name: r.name,
      role: r.role as PersonRole,
      ...opt("note", r.note),
      ...opt("nickname", r.nickname),
      ...(relation.success ? { relation: relation.data } : {}),
      ...opt("rules", r.rules),
      muted: r.muted === 1,
      unreviewed: r.unreviewed === 1,
      supervised: r.supervised === 1,
      any_hour: r.any_hour === 1,
      perms: permsOf(r.perms),
      addresses: addressesOf(r.id),
      created_at: r.created_at,
    };
  };
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
    /** `unreviewed`: someone who wrote first, kept silenced until the owner decides. */
    create(p: {
      name: string;
      role: Exclude<PersonRole, "owner">;
      note?: string | undefined;
      unreviewed?: boolean | undefined;
    }): Person {
      const id = newId("per");
      const at = now();
      const held = p.unreviewed ? 1 : 0;
      run(
        qb.insertInto("persons").values({
          id,
          name: p.name,
          role: p.role,
          note: p.note ?? null,
          muted: held,
          unreviewed: held,
          created_at: at,
          updated_at: at,
        }),
      );
      return repo.get(id) as Person;
    },
    update(id: string, p: { name?: string; role?: PersonRole } & PersonDetails): Person | undefined {
      const cur = repo.get(id);
      if (!cur) return undefined;
      // The owner's role never changes, and nobody else becomes the owner by an edit.
      const role = cur.role === "owner" ? "owner" : p.role === "owner" ? cur.role : (p.role ?? cur.role);
      // undefined keeps a field; "" (or null for the relation) clears it.
      const text = (next: string | undefined, prev: string | undefined) =>
        next === undefined ? (prev ?? null) : next || null;
      // Silenced and supervised are two ways of not answering on their own: turning one on turns the other off.
      const muted = p.muted ?? (p.supervised ? false : cur.muted);
      const supervised = p.supervised ?? (p.muted ? false : cur.supervised);
      run(
        qb
          .updateTable("persons")
          .set({
            name: p.name ?? cur.name,
            role,
            note: text(p.note, cur.note),
            nickname: text(p.nickname, cur.nickname),
            relation: p.relation === undefined ? (cur.relation ?? null) : p.relation,
            rules: text(p.rules, cur.rules),
            muted: muted ? 1 : 0,
            supervised: supervised ? 1 : 0,
            any_hour: (p.any_hour ?? cur.any_hour) ? 1 : 0,
            // Deciding whether they are answered (or who they are) is the owner's review.
            unreviewed:
              cur.unreviewed && p.muted === undefined && p.supervised === undefined && p.role === undefined ? 1 : 0,
            perms: JSON.stringify({ ...cur.perms, ...(p.perms ?? {}) }),
            updated_at: now(),
          })
          .where("id", "=", id),
      );
      return repo.get(id);
    },
    remove(id: string): boolean {
      if (id === OWNER_ID) return false;
      // Their commitments stay as plain tasks: no task keeps pointing at someone who is gone.
      return tx(() => {
        run(qb.updateTable("tasks").set({ person_id: null, owed_by: null }).where("person_id", "=", id));
        return run(qb.deleteFrom("persons").where("id", "=", id)) > 0;
      });
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
    /**
     * Links an address to a person; an address belongs to one person only (relinking moves it, and its chat with it:
     * whoever writes from there is that person now, the owner included).
     */
    link(personId: string, a: { channel: string; external_id: string; label?: string | undefined }): Address {
      run(qb.deleteFrom("addresses").where("channel", "=", a.channel).where("external_id", "=", a.external_id));
      run(
        qb
          .updateTable("threads")
          .set({ person_id: personId })
          .where("channel", "=", a.channel)
          .where("conversation", "=", a.external_id)
          .where("person_id", "is not", null),
      );
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
    /**
     * "This account is mine": an address approved as someone else's becomes the owner's. Its chats on that channel
     * become the owner's own, and the person, left with no address, is removed (their commitments stay as tasks).
     */
    giveToOwner(addressId: string): boolean {
      return tx(() => {
        const a = one(qb.selectFrom("addresses").selectAll().where("id", "=", addressId));
        if (!a || a.person_id === OWNER_ID) return false;
        repo.owner();
        run(qb.updateTable("addresses").set({ person_id: OWNER_ID }).where("id", "=", addressId));
        run(
          qb
            .updateTable("threads")
            .set({ person_id: OWNER_ID })
            .where("channel", "=", a.channel)
            .where("person_id", "=", a.person_id),
        );
        if (!addressesOf(a.person_id).length) repo.remove(a.person_id);
        return true;
      });
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
