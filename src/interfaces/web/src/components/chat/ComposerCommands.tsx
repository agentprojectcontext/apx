import { useEffect, useMemo } from "react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/** Built-in composer slash commands. More can land here later. */
export type SlashCommandId = "invite" | "new" | "tools";

export interface SlashCommand {
  id: SlashCommandId;
  /** Token after `/` — typed and shown as `/invite`. */
  slash: string;
  label: string;
  hint: string;
  /** After picking the command, open the agent list (`/invite `). */
  needsAgents?: boolean;
}

/** Which commands the current chat can offer. */
export function buildSlashCommands(opts: {
  canInvite?: boolean;
  canNewSession?: boolean;
  canToggleTools?: boolean;
}): SlashCommand[] {
  const out: SlashCommand[] = [];
  if (opts.canInvite) {
    out.push({
      id: "invite",
      slash: "invite",
      label: t("project.groups.cmd_invite_label"),
      hint: t("project.groups.cmd_invite_hint"),
      needsAgents: true,
    });
  }
  if (opts.canNewSession) {
    out.push({
      id: "new",
      slash: "new",
      label: t("project.groups.cmd_new_label"),
      hint: t("project.groups.cmd_new_hint"),
    });
  }
  if (opts.canToggleTools) {
    out.push({
      id: "tools",
      slash: "tools",
      label: t("project.groups.cmd_tools_label"),
      hint: t("project.groups.cmd_tools_hint"),
    });
  }
  return out;
}

/** Typing `/` or `/inv` (no space yet) → command menu. */
export function activeSlashCommand(value: string): { query: string } | null {
  const m = value.match(/^\s*\/([A-Za-z0-9_-]*)$/);
  return m ? { query: m[1] } : null;
}

/**
 * After `/invite ` — incomplete agent slug only.
 * `/invite andy ` or `/invite andy hola` → closed (user composing the message).
 */
export function activeInviteArg(value: string): { query: string } | null {
  const m = value.match(/^\s*\/invite\s+([A-Za-z0-9_-]*)$/i);
  return m ? { query: m[1] } : null;
}

/** Full send line: `/invite andy [message…]`. */
export function parseInviteCommand(text: string): { slug: string; message: string } | null {
  const m = text.trim().match(/^\/invite\s+([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  return { slug: m[1], message: (m[2] || "").trim() };
}

/** Ensure the invited agent is @mentioned so the cascade addresses them. */
export function messageForInvite(slug: string, message: string): string {
  const body = message.trim();
  if (!body) return `@${slug}`;
  if (new RegExp(`(?:^|[\\s([{])@${slug}\\b`, "i").test(body)) return body;
  return `@${slug} ${body}`;
}

export function filterSlashCommands(list: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) => c.slash.startsWith(q) || c.label.toLowerCase().includes(q) || c.id.includes(q),
  );
}

interface Props {
  commands: SlashCommand[];
  query: string;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onPick: (cmd: SlashCommand) => void;
  docked?: boolean;
}

/**
 * Drop-in list of `/` commands under the token strip.
 * Agent args for `/invite` live in ComposerSuggest — this is commands only.
 */
export function ComposerCommands({
  commands,
  query,
  activeIndex,
  onActiveIndexChange,
  onPick,
  docked = false,
}: Props) {
  const filtered = useMemo(() => filterSlashCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onActiveIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex, onActiveIndexChange]);

  if (filtered.length === 0) return null;

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
        {t("project.groups.cmd_menu")}
      </p>
      <ul role="listbox" className={cn("overflow-y-auto py-0.5", docked ? "max-h-40" : "max-h-56")}>
        {filtered.map((c, i) => {
          const active = i === activeIndex;
          return (
            <li key={c.id} role="option" aria-selected={active}>
              <button
                type="button"
                onMouseEnter={() => onActiveIndexChange(i)}
                onClick={() => onPick(c)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-1.5 text-left",
                  active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <code className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  /{c.slash}
                </code>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{c.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{c.hint}</span>
                </span>
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
