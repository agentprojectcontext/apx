import assert from "node:assert/strict";
import { test } from "node:test";
import type { Person, Thread } from "@apx/protocol";
import { contactsWithoutChat } from "./accountContacts.ts";

const person = (id: string, name: string, channels: string[], extra: Partial<Person> = {}) =>
  ({
    id,
    name,
    role: "contact",
    addresses: channels.map((channel) => ({ channel, external_id: `${id}@x` })),
    ...extra,
  }) as unknown as Person;
const chat = (id: string, account: string, personId: string, extra: Partial<Thread> = {}) =>
  [id, { id, channel: { id: account, conversation: id, person_id: personId }, ...extra } as unknown as Thread] as const;

const persons = [
  person("p_zoe", "Zoe", ["wa"]),
  person("p_ann", "Ann", ["wa"], { nickname: "Northwind" }),
  person("p_bob", "Bob", ["wa"]),
  person("p_tg", "Tess", ["tg"]),
  person("p_me", "Owner", ["wa"], { role: "owner" }),
];

test("an account lists its saved contacts with no chat on it, by name", () => {
  const threads = Object.fromEntries([chat("t1", "wa", "p_bob")]);
  assert.deepEqual(
    contactsWithoutChat(persons, threads, "wa").map((p) => p.id),
    ["p_ann", "p_zoe"],
  );
});

test("only a chat on this account takes a contact off it, an archived one too", () => {
  const threads = Object.fromEntries([chat("t1", "tg", "p_zoe"), chat("t2", "wa", "p_ann", { archived: true })]);
  assert.deepEqual(
    contactsWithoutChat(persons, threads, "wa").map((p) => p.id),
    ["p_bob", "p_zoe"],
  );
});

test("the search matches a name or a nickname", () => {
  assert.deepEqual(
    contactsWithoutChat(persons, {}, "wa", "north").map((p) => p.id),
    ["p_ann"],
  );
  assert.deepEqual(
    contactsWithoutChat(persons, {}, "wa", "ZO").map((p) => p.id),
    ["p_zoe"],
  );
});
