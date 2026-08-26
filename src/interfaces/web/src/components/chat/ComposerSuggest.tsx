import { useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "../agents/AgentAvatar";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/** One row the composer can suggest (@mention or /invite). */
export interface SuggestAgent {
  slug: string;
  name?: string | null;
  icon?: string | null;
  emoji?: string | null;
}

// ── Detection ────────────────────────────────────────────────────────────────

/** Trailing incomplete @handle: "hola @can" → query "can", start index of "@". */
export function activeMention(value: string): { start: number; query: string } | null {
  const m = value.match(/(?:^|[\s([{])@([A-Za-z0-9_-]*)$/);
  if (!m) return null;
  const query = m[1];
  const start = value.length - query.length - 1; // "@" position
  return { start, query };
}

/**
 * `/invite ` + incomplete slug — agent list for the arg.
 * Prefer `activeInviteArg` from ComposerCommands; kept here for the agent UI.
 */
export function activeInvite(value: string): { query: string } | null {
  const m = value.match(/^\s*\/invite\s+([A-Za-z0-9_-]*)$/i);
  return m ? { query: m[1] } : null;
}

export function filterAgents(list: SuggestAgent[], query: string): SuggestAgent[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, 12);
  return list
    .filter((a) => {
      const slug = a.slug.toLowerCase();
      const name = (a.name || "").toLowerCase();
      return slug.includes(q) || name.includes(q);
    })
    .slice(0, 12);
}

/** Replace the incomplete `@query` with `@slug `. */
export function applyMention(value: string, start: number, slug: string): string {
  return `${value.slice(0, start)}@${slug} `;
}

// ── UI ───────────────────────────────────────────────────────────────────────

type Mode = "mention" | "invite";

interface Props {
  mode: Mode;
  agents: SuggestAgent[];
  query: string;
  /** Controlled highlight index (owned by Composer for keyboard). */
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onPick: (slug: string) => void;
  /** Invite label: add to room vs escalate 1:1 → group. */
  inviteKind?: "add" | "escalate";
  /** Sit under the token strip inside the composer card (no floating sheet). */
  docked?: boolean;
}

/**
 * Agent picker for @mentions and /invite. Prefer `docked` under the token
 * strip so it shares the field's chrome instead of floating over the thread.
 * Keyboard (↑/↓/Enter/Esc) lives in the parent so the textarea keeps focus.
 */
export function ComposerSuggest({
  mode,
  agents,
  query,
  activeIndex,
  onActiveIndexChange,
  onPick,
  inviteKind = "add",
  docked = false,
}: Props) {
  const filtered = useMemo(() => filterAgents(agents, query), [agents, query]);

  // Keep the highlight inside the filtered list when the query shrinks it.
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onActiveIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex, onActiveIndexChange]);

  if (filtered.length === 0) {
    if (mode === "invite") {
      return (
        <div
          className={cn(
            "px-3 py-2 text-xs text-muted-foreground",
            docked
              ? "-mx-2 border-b border-border/70 bg-muted/25"
              : "rounded-xl border border-border bg-popover/95 shadow-md backdrop-blur",
          )}
        >
          {t("project.groups.all_in")}
        </div>
      );
    }
    return null;
  }

  const title =
    mode === "mention"
      ? t("project.groups.mention_pick")
      : inviteKind === "escalate"
        ? t("project.groups.make_group")
        : t("project.groups.add_member");

  return (
    <div
      className={cn(
        "text-sm",
        docked
          ? "-mx-2 border-b border-border/70 bg-muted/25"
          : "rounded-xl border border-border bg-popover/95 shadow-md backdrop-blur",
      )}
    >
      <p
        className={cn(
          "px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          !docked && "border-b border-border",
        )}
      >
        {title}
      </p>
      <ul role="listbox" className={cn("overflow-y-auto py-0.5", docked ? "max-h-40" : "max-h-56")}>
        {filtered.map((a, i) => {
          const label = a.name || a.slug;
          const active = i === activeIndex;
          return (
            <li key={a.slug} role="option" aria-selected={active}>
              <button
                type="button"
                onMouseEnter={() => onActiveIndexChange(i)}
                onClick={() => onPick(a.slug)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <AgentAvatar icon={a.icon} emoji={a.emoji} name={label} size={20} />
                <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
                <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  @{a.slug}
                </code>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={cn(
          "px-3 py-1 text-[10px] text-muted-foreground",
          !docked && "border-t border-border",
        )}
      >
        {t("project.groups.suggest_hint")}
      </div>
    </div>
  );
}

/** Arrow / Enter / Esc handling for an open suggest list. Returns true if consumed. */
export function handleSuggestKey(
  e: { key: string; preventDefault: () => void },
  opts: {
    open: boolean;
    count: number;
    activeIndex: number;
    setActiveIndex: (i: number | ((prev: number) => number)) => void;
    onConfirm: () => void;
    onDismiss: () => void;
  },
): boolean {
  if (!opts.open || opts.count === 0) return false;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    opts.setActiveIndex((i) => (i + 1) % opts.count);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    opts.setActiveIndex((i) => (i - 1 + opts.count) % opts.count);
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    opts.onConfirm();
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    opts.onDismiss();
    return true;
  }
  return false;
}

/** Local active-index state that resets when the suggest mode/query changes. */
export function useSuggestIndex(resetKey: string) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [resetKey]);
  return [activeIndex, setActiveIndex] as const;
}
