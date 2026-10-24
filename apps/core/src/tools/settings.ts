// apx_settings: the super-agent changes what the owner sets up in APX for them, through the owner's own methods, each
// change once the owner approves it. One tool for every setting, read on demand, so the prompt does not grow with the
// panel (rules/PROMPT_SIZE.md). Which methods it reaches is settings-reach.ts's to say. See DECISIONS.md#d-138
import { isMethodName, type MethodName, methods } from "@apx/protocol";
import { z } from "zod";
import type { TemplateRoot } from "../apc/templates.ts";
import type { Store } from "../domain/store.ts";
import type { ProfileRoot } from "../engine/profiles.ts";
import type { Params, Setting, SettingsDeps } from "./settings-kit.ts";
import { PEOPLE } from "./settings-people.ts";
import { TEAM } from "./settings-team.ts";
import { WORK } from "./settings-work.ts";
import { defineTool, type Tool } from "./types.ts";

/** What the super-agent may read and change, by method. */
export const SETTINGS: Readonly<Record<string, Setting>> = { ...PEOPLE, ...TEAM, ...WORK };

/** The area a method belongs to, as its card's title names it ("Changed a channel"). */
const AREA: Readonly<Record<string, string>> = {
  contacts: "a contact",
  channels: "a channel",
  imessage: "iMessage",
  owner: "the owner's profile",
  notices: "the notices",
  agents: "the agents",
  routines: "a routine",
  profiles: "an agent profile",
  tasks: "a task",
  threads: "a chat",
  sessions: "the imported sessions",
  projects: "a project",
  memory: "memory",
  skills: "the skills",
  resources: "a project's skills and servers",
  mcp: "an MCP server",
  extensions: "an extension",
  services: "the media services",
  surfaces: "a widget",
  stickers: "the stickers",
  environments: "the isolated computer",
};

/** What a call does, for its card's title in each language: a look, a change, or a removal, and in which area. */
export function settingAct(a: { method?: unknown; params?: unknown }): {
  act: "look" | "change" | "remove";
  area: string;
} {
  const method = typeof a.method === "string" ? a.method : "";
  const s = SETTINGS[method];
  const area = method.split(".")[0] ?? "";
  if (!s || s.read || !a.params) return { act: "look", area };
  return { act: /\.(remove|delete|unregister)$/.test(method) ? "remove" : "change", area };
}

/** The methods of each area ("contacts" → list, set…), the index the agent drills down from. */
function areas(): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const m of Object.keys(SETTINGS)) {
    const [area = "", verb = ""] = m.split(".");
    by.set(area, [...(by.get(area) ?? []), verb]);
  }
  return by;
}

/** A setting's method, or why there is none by that name. */
function settingOf(method: string): { name: MethodName; setting: Setting } | string {
  const setting = SETTINGS[method];
  if (!setting || !isMethodName(method)) return `no setting "${method}": call apx_settings with no args for the areas`;
  return { name: method, setting };
}

const empty = (v: unknown) => v === undefined || v === null || v === "";
const same = (a: unknown, b: unknown) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
const plain = (v: unknown): v is Params => !!v && typeof v === "object" && !Array.isArray(v);

/** A value on the card, cut at 300 characters unless the setting shows its values whole (Setting.whole). */
const shown = (v: unknown, whole = false) => {
  if (empty(v)) return "(none)";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${!whole && s.length > 300 ? `${s.slice(0, 300)}…` : s}"`;
};

type Words = Readonly<Record<string, (v: unknown) => string>>;

/** The card's lines: each field that changes, before → after, nested settings by their path ("channel.strangers"). */
function changedFields(
  now: Params | undefined,
  p: Params,
  path = "",
  named: readonly string[] = [],
  words: Words = {},
  whole = false,
): string[] {
  const lines = Object.entries(p).flatMap(([k, v]) => {
    // The record's own id names it on the card's first line; only another id is a change.
    if (!path && k === "id" && (!now || same(now.id, v))) return [];
    if (!path && named.includes(k)) return [];
    const word = words[`${path}${k}`];
    if (!now) return [word ? word(v) : `${path}${k}: ${shown(v, whole)}`];
    const was = now[k];
    if (same(was, v)) return [];
    if (word) return [word(v)];
    const inner =
      plain(v) && (plain(was) || empty(was))
        ? changedFields(plain(was) ? was : {}, v, `${path}${k}.`, [], words, whole)
        : [];
    return inner.length ? inner : [`${path}${k}: ${shown(was, whole)} → ${shown(v, whole)}`];
  });
  // Inside a record given back whole (a channel), a worded field left out is dropped (its hours): a change too.
  const dropped = Object.entries(words).flatMap(([w, word]) => {
    const k = w.slice(path.length);
    const gone = path && now && w.startsWith(path) && !k.includes(".") && !empty(now[k]) && !(k in p);
    return gone ? [word(undefined)] : [];
  });
  return [...lines, ...dropped];
}

export function settingsTools(
  store: Store,
  roots: { profiles?: readonly ProfileRoot[]; templates?: TemplateRoot[] } = {},
): Tool[] {
  const deps: SettingsDeps = { store, profiles: roots.profiles ?? [], templates: roots.templates ?? [] };
  const args = z.object({
    method: z.string().trim().min(1).max(60).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  });
  type Args = z.output<typeof args>;
  /** A call that changes something: a setting that is not a read, with what to change. */
  const changes = (a: Args) => {
    const s = a.method ? SETTINGS[a.method] : undefined;
    return !!s && !s.read && a.params !== undefined;
  };
  const filled = (a: Args) => {
    const s = settingOf(a.method ?? "");
    const p = a.params ?? {};
    return typeof s === "string" ? p : (s.setting.keep?.(p, deps) ?? p);
  };
  const card = (a: Args) => {
    const s = SETTINGS[a.method ?? ""];
    const p = filled(a);
    const now = s?.now?.(p, deps);
    const words = Object.fromEntries(Object.entries(s?.words ?? {}).map(([k, w]) => [k, (v: unknown) => w(v, deps)]));
    return {
      says: s?.says?.(p, deps) ?? a.method,
      lines: changedFields(now, p, "", s?.named, words, s?.whole),
      known: !!now,
    };
  };
  /** A change to a record that already is so: answered without asking the owner. */
  const unchanged = (a: Args) => {
    if (!changes(a)) return false;
    const c = card(a);
    return c.known && !c.lines.length;
  };
  return [
    defineTool({
      name: "apx_settings",
      description:
        "Read and change what the owner sets up in APX for them (contacts, channels, their profile, notices, projects, memory, which agents may use the isolated computer…). No args: the areas; method: an area's methods, or a method's fields; method + params: run it. Each change waits for the owner's OK.",
      args,
      effect: "local",
      // What the owner set up is theirs: every change waits for their yes.
      confirm: (a) => (changes(a) && !unchanged(a) ? "always" : "never"),
      ownerSetting: (a) => changes(a) && !unchanged(a),
      // Long enough for a reindex or a repo's skills; a read answers at once.
      deadlineMs: 120_000,
      title: (a) => {
        const { act, area } = settingAct(a);
        const what = AREA[area] ?? "a setting";
        return act === "look" ? "Looked at the settings" : `${act === "remove" ? "Removed" : "Changed"} ${what}`;
      },
      // Before the owner is asked: nobody approves a call the method would refuse, or a field that stays theirs.
      check(a) {
        if (!a.method || areas().has(a.method)) return;
        const s = settingOf(a.method);
        if (typeof s === "string") throw new Error(s);
        if (s.setting.read || !a.params) return;
        const refused = s.setting.refuse?.(a.params, deps);
        if (refused) throw new Error(`${a.method}: ${refused}`);
        const r = methods[s.name].params.safeParse(filled(a));
        if (!r.success)
          throw new Error(`${a.method}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      },
      explain: (a) => {
        if (!changes(a)) return undefined;
        const c = card(a);
        return [c.says, ...c.lines].join("\n");
      },
      async run(a, ctx) {
        if (!a.method)
          return [
            "Areas and their methods; call with method: an area for what each does, a method for its fields.",
            ...[...areas()].map(([area, verbs]) => `- ${area}: ${verbs.join(", ")}`),
            "Agents' definitions, routines and the shared limits have tools of their own. Keys, sign-ins, models, how far agents may act and the machine APX runs on stay the owner's, in Settings.",
          ].join("\n");
        const area = areas().get(a.method);
        if (area)
          return area
            .map((verb) => `${a.method}.${verb}`)
            .map((m) => `- ${m}${SETTINGS[m]?.read ? " (read)" : ""}: ${SETTINGS[m]?.does}`)
            .join("\n");
        const s = settingOf(a.method);
        if (typeof s === "string") return s;
        if (s.setting.read) return s.setting.read(a.params ?? {}, deps);
        if (!a.params) {
          const { $schema: _, ...schema } = z.toJSONSchema(methods[s.name].params, { io: "input" }) as Params;
          return `${a.method} takes: ${JSON.stringify(schema).slice(0, 4000)}`;
        }
        if (unchanged(a)) return `nothing to change: ${card(a).says} — it already is so.`;
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const result = await ctx.callAsOwner(s.name, filled(a) as never);
        return `done: ${s.setting.shows?.(result) ?? JSON.stringify(result).slice(0, 1500)}`;
      },
    }),
  ];
}
