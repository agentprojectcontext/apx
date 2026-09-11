import { useMemo, useState } from "react";
import useSWR from "swr";
import { ChevronRight, Lock, Minus, Check } from "lucide-react";
import { Agents } from "../../lib/api/agents";
import { Switch } from "../ui";
import { Tip } from "../ui/tip";
import { cn } from "../../lib/cn";
import { t, type TKey } from "../../i18n";
import { toneOutline } from "../../lib/tone";

// Per-agent tool selection, grouped by the registry's own categories.
//
// It replaces a flat wall of chips fed by /api/tools — the daemon's HTTP
// surface, a different 43-entry catalog that only overlapped this one by
// accident. Every task verb, call_agent, ask_questions, git, calendar and
// obsidian had no chip to tick, and `session_compact`, which that catalog does
// have, is not a tool an agent can call and was dropped in silence on save.
//
// Three states per group, because picking 10 tools one chip at a time is how a
// card ends up missing one: tick the group to take all of it, then untick the
// two you did not want (`tasks` minus `update_task` is a real shape — an agent
// that reads and files but does not rewrite someone else's work).

/**
 * The order groups are shown in — most reached-for first — and their labels.
 * A category the registry grows that is not listed here still renders, after
 * these and under its raw id: a new group must never be invisible just because
 * nobody wrote a translation for it yet.
 */
const GROUPS: [string, TKey][] = [
  ["tasks",        "agent_tools.group_tasks"],
  ["files",        "agent_tools.group_files"],
  ["messages",     "agent_tools.group_messages"],
  ["agents",       "agent_tools.group_agents"],
  ["memory",       "agent_tools.group_memory"],
  ["sessions",     "agent_tools.group_sessions"],
  ["code",         "agent_tools.group_code"],
  ["shell",        "agent_tools.group_shell"],
  ["mcp",          "agent_tools.group_mcp"],
  ["skills",       "agent_tools.group_skills"],
  ["routines",     "agent_tools.group_routines"],
  ["artifacts",    "agent_tools.group_artifacts"],
  ["projects",     "agent_tools.group_projects"],
  ["inventory",    "agent_tools.group_inventory"],
  ["integrations", "agent_tools.group_integrations"],
  ["browser",      "agent_tools.group_browser"],
  ["fetch",        "agent_tools.group_fetch"],
  ["search",       "agent_tools.group_search"],
  ["runtime",      "agent_tools.group_runtime"],
  ["voice",        "agent_tools.group_voice"],
];
const GROUP_ORDER = GROUPS.map(([id]) => id);
const GROUP_LABEL = new Map<string, TKey>(GROUPS);

function groupLabel(id: string) {
  const key = GROUP_LABEL.get(id);
  return key ? t(key) : id;
}

export function AgentToolsPicker({
  value, onChange, useAll, onUseAll, matchHeight,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** "All": no declared list at all, so the agent inherits the whole registry. */
  useAll: boolean;
  onUseAll: (v: boolean) => void;
  matchHeight?: number;
}) {
  const { data, isLoading } = useSWR("/api/agents/tools", () => Agents.toolCatalog());
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const core = useMemo(() => new Set(data?.core ?? []), [data]);

  // A card written against the old picker holds `memory_get`; the runtime
  // resolves it to read_self_memory. Draw it where it actually lands.
  const selected = useMemo(() => {
    const aliases = data?.aliases ?? {};
    return new Set(value.map((n) => aliases[n] ?? n));
  }, [value, data]);

  // Core tools are not a choice — they live in their own locked strip, so they
  // must not count toward a group's "3 of 7" either.
  const groups = useMemo(() => {
    const by = new Map<string, { name: string; description: string }[]>();
    for (const tool of data?.tools ?? []) {
      if (core.has(tool.name)) continue;
      const list = by.get(tool.category) ?? [];
      list.push({ name: tool.name, description: tool.description });
      by.set(tool.category, list);
    }
    const known = GROUP_ORDER.filter((g) => by.has(g));
    const rest = [...by.keys()].filter((g) => !GROUP_ORDER.includes(g)).sort();
    return [...known, ...rest].map((id) => ({ id, tools: by.get(id)! }));
  }, [data, core]);

  const write = (next: Set<string>) => onChange([...next].filter((n) => !core.has(n)));

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    write(next);
  };

  const toggleGroup = (tools: { name: string }[]) => {
    const next = new Set(selected);
    const all = tools.every((tool) => next.has(tool.name));
    for (const tool of tools) {
      if (all) next.delete(tool.name); else next.add(tool.name);
    }
    write(next);
  };

  const total = groups.reduce((n, g) => n + g.tools.length, 0);
  const picked = groups.reduce((n, g) => n + g.tools.filter((x) => selected.has(x.name)).length, 0);

  return (
    <div className="space-y-3">
      <Switch checked={useAll} onChange={onUseAll} label={t("agent_tools.use_all")} />
      <p className="-mt-1 text-[11px] text-muted-fg">
        {useAll
          ? t("agent_tools.use_all_on", { count: data?.default_count ?? 0 })
          : t("agent_tools.use_all_off", { picked, total })}
      </p>

      {data && data.core.length > 0 && (
        <div className={cn("rounded-lg border border-border bg-muted/20 px-2.5 py-2", useAll && "opacity-40")}>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-fg">
            <Lock size={10} /> {t("agent_tools.core_title")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {data.core.map((name) => (
              <span key={name} className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-fg">
                {name}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-fg">{t("agent_tools.core_hint")}</p>
        </div>
      )}

      <div
        className={cn(
          "overflow-y-auto rounded-lg border border-border",
          useAll && "pointer-events-none opacity-40",
        )}
        style={{ maxHeight: matchHeight ? `${matchHeight}px` : undefined }}
        aria-disabled={useAll}
      >
        {isLoading && <p className="p-3 text-xs text-muted-fg">{t("common.loading")}</p>}
        <ul className="divide-y divide-border">
          {groups.map(({ id, tools }) => {
            const on = tools.filter((x) => selected.has(x.name)).length;
            const state = on === 0 ? "none" : on === tools.length ? "all" : "some";
            // Opened when something in it is picked: the shape of the choice is
            // the thing worth seeing at a glance.
            const expanded = open[id] ?? state !== "none";
            return (
              <li key={id}>
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(tools)}
                    aria-label={groupLabel(id)}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                      state === "none" ? "border-border" : toneOutline.emerald,
                    )}
                  >
                    {state === "all" && <Check size={10} />}
                    {state === "some" && <Minus size={10} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [id]: !expanded }))}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <ChevronRight
                      size={12}
                      className={cn("shrink-0 text-muted-fg transition-transform", expanded && "rotate-90")}
                    />
                    <span className="truncate text-xs">{groupLabel(id)}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-fg">
                      {on}/{tools.length}
                    </span>
                  </button>
                </div>
                {expanded && (
                  <div className="flex flex-wrap gap-1 px-2.5 pb-2 pl-9">
                    {tools.map((tool) => {
                      const isOn = selected.has(tool.name);
                      return (
                        <Tip key={tool.name} content={tool.description || tool.name}>
                          <button
                            type="button"
                            onClick={() => toggle(tool.name)}
                            className={cn(
                              "rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors",
                              isOn ? toneOutline.emerald : "border-border text-muted-fg hover:text-foreground",
                            )}
                          >
                            {tool.name}
                          </button>
                        </Tip>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
