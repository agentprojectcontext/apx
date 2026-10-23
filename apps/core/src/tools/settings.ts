// apx_settings: the super-agent changes what the owner sets up in APX for them, through the owner's own methods, each
// change once the owner approves it. One tool for every setting, read on demand, so the prompt does not grow with the
// panel (rules/PROMPT_SIZE.md). Which methods it reaches is settings-reach.ts's to say. See DECISIONS.md#d-138
import { isMethodName, type MethodName, methods, type Person } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { inlineName } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

type Params = Record<string, unknown>;

type Setting = {
  /** What it does, in the list the agent reads. */
  does: string;
  /** A read: answered from the store, with no confirmation. */
  read?: (p: Params, store: Store) => string;
  /** The card's first line: what changes, named as the owner names it. */
  says?: (p: Params, store: Store) => string;
  /** The record as it is now, so the card shows each field before and after. */
  now?: (p: Params, store: Store) => Params | undefined;
  /** Fields the method needs that the record already has (a contact's name). */
  keep?: (p: Params, store: Store) => Params;
  /** What the agent reads back once it ran (default: the method's result). */
  shows?: (result: unknown) => string;
};

const personOf = (p: Params, store: Store) => (typeof p.id === "string" ? store.persons.get(p.id) : undefined);
const stickerOf = (p: Params, store: Store) => (typeof p.id === "string" ? store.stickers.get(p.id) : undefined);

/** One line per kept sticker: what it means, how often it came and was sent, and whether the agent may send it. */
const stickerLine = (s: {
  id: string;
  meaning?: string;
  hint?: string;
  seen: number;
  sent: number;
  blocked: boolean;
}) =>
  `- [${s.id}] ${s.meaning ? `"${inlineName(s.meaning)}"` : "not named yet"}${s.hint ? ` ${s.hint}` : ""} (arrived ${s.seen}, sent ${s.sent}${s.blocked ? ", you may not send it" : ""})`;

/** One line per contact with everything the owner edits on their card. */
function contactLine(p: Person): string {
  const on = [...new Set(p.addresses.map((a) => a.channel))].join(", ") || "no channel";
  const flags = [
    p.muted ? "silenced" : "",
    p.supervised ? "supervised" : "",
    p.any_hour ? "any hour" : "",
    ...Object.entries(p.perms)
      .filter(([, on]) => on)
      .map(([k]) => `may: ${k}`),
  ].filter(Boolean);
  const bits = [
    p.role !== "contact" ? p.role : "",
    p.relation ?? "",
    p.nickname ? `nickname "${inlineName(p.nickname)}"` : "",
    `on ${on}`,
    ...flags,
  ].filter(Boolean);
  const text = [p.note ? `note: ${p.note}` : "", p.rules ? `rules: ${p.rules}` : ""].filter(Boolean).join("; ");
  return `- ${inlineName(p.name) || "someone"} [${p.id}] (${bits.join(", ")})${text ? ` ${text.slice(0, 600)}` : ""}`;
}

/** What the super-agent may read and change, by method. */
export const SETTINGS: Readonly<Record<string, Setting>> = {
  "contacts.list": {
    does: "every contact with what the owner edits on their card: relation, nickname, note, rules, flags",
    read: (_p, store) =>
      store.persons
        .list()
        .filter((p) => p.role !== "owner")
        .slice(0, 100)
        .map(contactLine)
        .join("\n") || "no contacts yet.",
  },
  "contacts.set": {
    does: "change a contact (id and only what changes: note says who they are, rules how to answer them) or add one",
    says: (p, store) => {
      const cur = personOf(p, store);
      return cur ? `Change the contact ${inlineName(cur.name)}` : `Add the contact ${inlineName(String(p.name ?? ""))}`;
    },
    now: (p, store) => personOf(p, store),
    keep: (p, store) => {
      const cur = personOf(p, store);
      return cur && p.name === undefined ? { ...p, name: cur.name } : p;
    },
    shows: (r) => contactLine(r as Person),
  },
  "contacts.remove": {
    does: "forget a contact (id), or only one of their addresses (address)",
    says: (p, store) => {
      const cur = personOf(p, store);
      return cur ? `Forget the contact ${inlineName(cur.name)}` : "Forget an address of a contact";
    },
  },
  "stickers.list": {
    does: "the stickers kept from a channel type (platform: whatsapp or telegram), what each means and if you may send it",
    read: (p, store) =>
      store.stickers
        .list(String(p.platform ?? ""))
        .slice(0, 100)
        .map(stickerLine)
        .join("\n") || "no stickers kept there yet.",
  },
  "stickers.set": {
    does: "say what a sticker means (id, meaning) or whether you may send it (blocked)",
    says: (p, store) => `Change the sticker ${inlineName(stickerOf(p, store)?.meaning ?? String(p.id ?? ""))}`,
    now: (p, store) => {
      const cur = stickerOf(p, store);
      return cur && { meaning: cur.meaning ?? "", blocked: cur.blocked };
    },
    shows: (r) => stickerLine(r as Parameters<typeof stickerLine>[0]),
  },
  "stickers.remove": {
    does: "forget a sticker and its file (id); if someone sends it again it is kept again",
    says: (p, store) => `Forget the sticker ${inlineName(stickerOf(p, store)?.meaning ?? String(p.id ?? ""))}`,
  },
};

/** A setting's method, or why there is none by that name. */
function settingOf(method: string): { name: MethodName; setting: Setting } | string {
  const setting = SETTINGS[method];
  if (!setting || !isMethodName(method)) return `no setting "${method}": call apx_settings with no args for the list`;
  return { name: method, setting };
}

const shown = (v: unknown) => {
  if (v === undefined || v === null || v === "") return "(none)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `"${s.length > 300 ? `${s.slice(0, 300)}…` : s}"`;
};

export function settingsTools(store: Store): Tool[] {
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
    return typeof s === "string" ? p : (s.setting.keep?.(p, store) ?? p);
  };
  return [
    defineTool({
      name: "apx_settings",
      description:
        "Read and change what the owner sets up in APX for them (contacts: who they are, rules to answer them, notes). No args: what you can read and change. method alone: its fields. method + params: run it; a change waits for the owner's OK.",
      args,
      effect: "local",
      // What the owner set up is theirs: every change waits for their yes.
      confirm: (a) => (changes(a) ? "always" : "never"),
      deadlineMs: 15_000,
      title: (a) => (a.params && a.method ? `Changed ${a.method}` : "Looked at the settings"),
      // Before the owner is asked: nobody approves a call the method would refuse.
      check(a) {
        if (!a.method) return;
        const s = settingOf(a.method);
        if (typeof s === "string") throw new Error(s);
        if (s.setting.read || !a.params) return;
        const r = methods[s.name].params.safeParse(filled(a));
        if (!r.success)
          throw new Error(`${a.method}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      },
      explain: (a) => {
        if (!changes(a)) return undefined;
        const s = SETTINGS[a.method ?? ""];
        const p = filled(a);
        const now = s?.now?.(p, store);
        const fields = Object.entries(p)
          .filter(([k, v]) => k !== "id" && (!now || JSON.stringify(now[k]) !== JSON.stringify(v)))
          .map(([k, v]) => (now ? `${k}: ${shown(now[k])} → ${shown(v)}` : `${k}: ${shown(v)}`));
        return [s?.says?.(p, store) ?? a.method, ...fields].join("\n");
      },
      async run(a, ctx) {
        if (!a.method)
          return [
            ...Object.entries(SETTINGS).map(([m, s]) => `- ${m}${s.read ? " (read)" : ""}: ${s.does}`),
            "Agents, routines, limits and channel hours have tools of their own. Keys, sign-ins, models and what agents may do stay the owner's, in Settings.",
          ].join("\n");
        const s = settingOf(a.method);
        if (typeof s === "string") return s;
        if (s.setting.read) return s.setting.read(a.params ?? {}, store);
        if (!a.params) {
          const { $schema: _, ...schema } = z.toJSONSchema(methods[s.name].params, { io: "input" }) as Params;
          return `${a.method} takes: ${JSON.stringify(schema).slice(0, 4000)}`;
        }
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const result = await ctx.callAsOwner(s.name, filled(a) as never);
        return `done: ${s.setting.shows?.(result) ?? JSON.stringify(result).slice(0, 1500)}`;
      },
    }),
  ];
}
