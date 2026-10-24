// What a setting of apx_settings is made of, and the lookups its cards share: every record named as the owner names
// it in the panel, never by a bare id. The areas are settings-people.ts, settings-team.ts and settings-work.ts.

import type { TemplateRoot } from "../apc/templates.ts";
import type { Store } from "../domain/store.ts";
import type { ProfileRoot } from "../engine/profiles.ts";
import { inlineName } from "./result.ts";

export type Params = Record<string, unknown>;

/** What a setting reads besides the store: where profiles and agent templates are found. */
export type SettingsDeps = {
  store: Store;
  profiles: readonly ProfileRoot[];
  templates: TemplateRoot[];
};

export type Setting = {
  /** What it does, in the list the agent reads. */
  does: string;
  /** A read: answered from the store, with no confirmation. */
  read?: (p: Params, d: SettingsDeps) => string;
  /** The card's first line: what changes, named as the owner names it. */
  says?: (p: Params, d: SettingsDeps) => string;
  /** The params that first line already says (the record it names), left off the lines under it. */
  named?: readonly string[];
  /** A field the owner reads in words, not as before → after, by its path ("channel.hours"); undefined: it is dropped. */
  words?: Readonly<Record<string, (v: unknown, d: SettingsDeps) => string>>;
  /** The record as it is now, so the card shows each field before and after, and an equal one asks nobody. */
  now?: (p: Params, d: SettingsDeps) => Params | undefined;
  /** The whole record the method needs, from what the agent gave and what the record already has. */
  keep?: (p: Params, d: SettingsDeps) => Params;
  /** Why this call stays the owner's (a field like autonomy, a record that is not there), before anyone is asked. */
  refuse?: (p: Params, d: SettingsDeps) => string | undefined;
  /** What the agent reads back once it ran (default: the method's result). */
  shows?: (result: unknown) => string;
  /** Its card shows every value whole: a cut could hide what it runs or where a key goes. */
  whole?: true;
};

export const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A field the owner keeps for themselves, refused when the call would change it. */
export function ownersField(p: Params, now: Params | undefined, field: string, why: string): string | undefined {
  if (p[field] === undefined) return undefined;
  if (now && JSON.stringify(now[field] ?? null) === JSON.stringify(p[field] ?? null)) return undefined;
  return `${field} stays the owner's: ${why}`;
}

/** Fields given over what the record has: the method replaces the whole record, so a field left out keeps its value. */
export const merged = (now: Params | undefined, p: Params): Params => ({ ...now, ...p });

export function projectName(store: Store, id: unknown): string {
  if (id === undefined || id === null || id === "") return "the base project";
  const p = store.projects.get(str(id));
  return `the project ${inlineName(p?.name ?? str(id))}`;
}

/** An agent by id or slug, archived ones too. */
export function agentName(store: Store, ref: unknown): string {
  const r = str(ref);
  const a = store.agents.get(r) ?? [...store.agents.list(), ...store.agents.archived()].find((x) => x.slug === r);
  return inlineName(a?.name ?? store.agents.archived().find((x) => x.id === r)?.name ?? r);
}

export const quoted = (text: string | undefined, max = 200) =>
  `"${(text ?? "").replace(/\s+/g, " ").trim().slice(0, max)}${(text?.length ?? 0) > max ? "…" : ""}"`;
