import useSWR from "swr";
import { Lock, Sparkles } from "lucide-react";
import { Skills } from "../../lib/api/skills";
import { Switch } from "../ui";
import { Tip } from "../ui/tip";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneOutline } from "../../lib/tone";

// Per-agent skill selection, fed by the project's own skill list so the choices
// here are exactly what /skills shows for this project.
//
// Two independent gates decide a row's state:
//   • scope gate  — a skill switched off globally or for this project can't be
//     turned on for one agent. It renders locked. If the agent had already
//     declared it, the box still reads checked (the declaration survives in
//     frontmatter) — it just can't be toggled until the scope re-enables it.
//   • agent gate  — the agent's own Skills frontmatter list.
//
// Declaring nothing clears the agent's list, and that does NOT mean "inherit the
// project's skills" — this used to say it did. loadAgentSkills() iterates the
// declared list and stops, so an agent with none gets none injected. What it
// does keep is reach: list_skills / load_skill are in the core floor, so the
// project's whole catalog is still one tool call away. Injected in the prompt
// and reachable at runtime are different promises and the copy now says which.
export function AgentSkillsPicker({
  value, onChange, projectPath, useDefaults, onUseDefaults, available, matchHeight,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  projectPath?: string;
  /** No declared list: nothing is injected. */
  useDefaults: boolean;
  onUseDefaults: (v: boolean) => void;
  /** How many the project exposes, for the "still reachable" line. */
  available?: number;
  /** Cap the scroller. */
  matchHeight?: number;
}) {
  const { data, isLoading } = useSWR(
    ["/api/skills", projectPath ?? "default"],
    () => Skills.list(projectPath),
  );
  const skills = data?.skills ?? [];
  const selected = new Set(value);
  // "All" means all the ones this project can actually turn on — a skill locked
  // off at project or global scope is not a choice here either.
  const selectable = skills.filter((s) => !(s.enabled === false && !s.private));
  // What this agent HAS floats to the top. The list is the project's whole
  // catalog — 55 rows on this install — and four ticked boxes scattered through
  // it are invisible: the question the screen has to answer at a glance is
  // "what does this agent carry", not "what exists".
  const rows = [...skills].sort((a, b) => {
    const pick = Number(selected.has(b.slug)) - Number(selected.has(a.slug));
    return pick !== 0 ? pick : a.slug.localeCompare(b.slug);
  });

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    onChange([...next]);
  };

  return (
    <div className="space-y-3">
      <Switch
        checked={useDefaults}
        onChange={onUseDefaults}
        label={t("agents_form.skills_use_defaults")}
      />
      <p className="-mt-1 text-[11px] text-muted-fg">
        {useDefaults ? t("agent_tools.skills_none") : t("agents_form.skills_use_defaults_hint")}
        {available ? " " + t("agent_tools.skills_reachable", { count: available }) : ""}
      </p>

      {!useDefaults && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(selectable.map((x) => x.slug))}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-fg hover:text-foreground"
          >
            {t("agent_tools.skills_all")}
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-fg hover:text-foreground"
          >
            {t("agent_tools.skills_clear")}
          </button>
          <span className="text-[10px] text-muted-fg">
            {t("agent_tools.skills_all_hint")}
          </span>
        </div>
      )}

      <div
        className={cn(
          "overflow-y-auto rounded-lg border border-border",
          useDefaults && "pointer-events-none opacity-40",
        )}
        style={{ maxHeight: matchHeight ? `${matchHeight}px` : undefined }}
        aria-disabled={useDefaults}
      >
        {isLoading && <p className="p-3 text-xs text-muted-fg">{t("common.loading")}</p>}
        {!isLoading && skills.length === 0 && (
          <p className="p-3 text-xs text-muted-fg">{t("agents_form.skills_empty")}</p>
        )}
        <ul className="divide-y divide-border">
          {rows.map((s) => {
            // `enabled === false` = switched off for this scope. Built-in
            // private skills are always on, so they never lock.
            const lockedByScope = s.enabled === false && !s.private;
            const on = selected.has(s.slug);
            const row = (
              <button
                type="button"
                disabled={lockedByScope || useDefaults}
                onClick={() => toggle(s.slug)}
                className={cn(
                  "flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors",
                  lockedByScope ? "cursor-not-allowed opacity-45" : "hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    on ? toneOutline.emerald : "border-border",
                  )}
                >
                  {on && <Sparkles size={10} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[11px]">{s.slug}</span>
                    {lockedByScope && <Lock size={10} className="shrink-0 text-muted-fg" />}
                  </span>
                  {s.description && (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-fg">{s.description}</span>
                  )}
                </span>
              </button>
            );
            return (
              <li key={s.slug}>
                {lockedByScope
                  ? <Tip content={t("agents_form.skills_locked")}>{row}</Tip>
                  : row}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
