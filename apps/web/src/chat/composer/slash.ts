// The composer's "/" menu: what a field starting with "/" offers. Commands act on the chat (new, compact, model,
// effort, stop, usage, skills); every skill can be named too ("/pdf …"), and the core then loads it whole.

export type CommandId = "new" | "compact" | "model" | "effort" | "stop" | "usage" | "skills";

/** `sub`: picking it opens a second list (models, efforts) instead of acting. */
export type Command = { id: CommandId; aliases: readonly string[]; sub?: boolean };

export const COMMANDS: readonly Command[] = [
  { id: "new", aliases: ["clear"] },
  { id: "compact", aliases: ["summarize", "resumir"] },
  { id: "model", aliases: ["modelo"], sub: true },
  { id: "effort", aliases: ["esfuerzo", "reasoning"], sub: true },
  { id: "stop", aliases: ["cancel", "parar"] },
  { id: "usage", aliases: ["context", "cost", "uso"] },
  { id: "skills", aliases: [] },
];

export type SlashItem =
  | { kind: "command"; id: CommandId; sub: boolean }
  | { kind: "skill"; name: string; description: string }
  | { kind: "model"; ref: string; label: string; current: boolean }
  | { kind: "effort"; effort: string; current: boolean };

/** What the field asks the menu for: "/mo" → head "mo"; "/model gpt" → head "model", arg "gpt". */
export function slashQuery(text: string): { head: string; arg: string | undefined } | undefined {
  const m = /^\/([^\s/]*)(?:\s(.*))?$/.exec(text);
  if (!m || text.includes("\n")) return undefined;
  return { head: (m[1] ?? "").toLowerCase(), arg: m[2] };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Ranks a name against what was typed: a prefix first, then anywhere in it, else no match. */
function rank(name: string, typed: string): number | undefined {
  const n = fold(name);
  const q = fold(typed);
  if (!q) return 1;
  if (n.startsWith(q)) return 0;
  return n.includes(q) ? 1 : undefined;
}

export type SlashContext = {
  /** The agent works now: "/stop" is offered only then. */
  busy: boolean;
  skills: ReadonlyArray<{ name: string; description: string }>;
  models: ReadonlyArray<{ ref: string; label: string }>;
  /** The chat's model now (with its effort, if any) and the efforts that model takes. */
  currentModel: string | undefined;
  efforts: readonly string[];
  currentEffort: string | undefined;
};

const MAX = 40;

/** The menu's rows for this field, best first; none = no menu. */
export function slashItems(text: string, ctx: SlashContext): SlashItem[] {
  const q = slashQuery(text);
  if (!q) return [];
  if (q.arg !== undefined) {
    const arg = q.arg.trim();
    if (q.head === "model" || q.head === "modelo")
      return ctx.models
        .flatMap((m) => {
          const r = Math.min(rank(m.ref, arg) ?? 9, rank(m.label, arg) ?? 9);
          return r < 9 ? [{ r, m }] : [];
        })
        .sort((a, b) => a.r - b.r)
        .slice(0, MAX)
        .map(({ m }) => ({ kind: "model" as const, ref: m.ref, label: m.label, current: m.ref === ctx.currentModel }));
    if (q.head === "effort" || q.head === "esfuerzo")
      return ctx.efforts
        .filter((e) => rank(e, arg) !== undefined)
        .map((effort) => ({ kind: "effort" as const, effort, current: effort === ctx.currentEffort }));
    // "/pdf leé esto": a skill with its words, sent as written.
    return [];
  }
  const commands = COMMANDS.filter((c) => c.id !== "stop" || ctx.busy)
    .flatMap((c) => {
      if (c.id === "effort" && !ctx.efforts.length) return [];
      const r = Math.min(...[c.id, ...c.aliases].map((n) => rank(n, q.head) ?? 9));
      return r < 9 ? [{ r, item: { kind: "command" as const, id: c.id, sub: Boolean(c.sub) } }] : [];
    })
    .sort((a, b) => a.r - b.r);
  const skills = ctx.skills
    .flatMap((s) => {
      const r = rank(s.name, q.head) ?? (q.head && fold(s.description).includes(fold(q.head)) ? 2 : undefined);
      return r === undefined ? [] : [{ r, item: { kind: "skill" as const, name: s.name, description: s.description } }];
    })
    .sort((a, b) => a.r - b.r || a.item.name.localeCompare(b.item.name));
  return [...commands, ...skills].map((x) => x.item).slice(0, MAX);
}
