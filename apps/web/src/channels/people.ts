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
  associate: "ch.rel.associate",
  provider: "ch.rel.provider",
  other: "ch.rel.other",
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
