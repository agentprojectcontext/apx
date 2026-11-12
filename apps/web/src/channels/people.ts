// What the channel screens say about a person (their relation, their initials), apart from the screens themselves:
// the Inbox's contact chat uses them without loading the channel screen.
import type { Person } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

export const RELATION_KEY: Record<NonNullable<Person["relation"]>, MessageKey> = {
  partner: "ch.rel.partner",
  family: "ch.rel.family",
  friend: "ch.rel.friend",
  coworker: "ch.rel.coworker",
  client: "ch.rel.client",
  lead: "ch.rel.lead",
  associate: "ch.rel.associate",
  provider: "ch.rel.provider",
  other: "ch.rel.other",
};

/** The relations, the ones most chats need first. */
export const RELATIONS: NonNullable<Person["relation"]>[] = [
  "client",
  "lead",
  "associate",
  "provider",
  "family",
  "friend",
  "partner",
  "coworker",
  "other",
];

/** The first letter of each word, leaving out a "(@handle)" and anything that is not a letter or digit ("@ana"). */
export const initials = (name: string) =>
  name
    .replace(/\(@[^)]*\)/g, "")
    .split(/\s+/)
    .map((w) => /[\p{L}\p{N}]/u.exec(w)?.[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
