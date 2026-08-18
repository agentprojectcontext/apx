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
// "Use the project defaults" clears the agent's list entirely: an agent with no
// declared skills inherits whatever the project enables, which is what the
// runtime already does (see agentSkills() in build-agent-system.js).
export function AgentSkillsPicker({
  value, onChange, projectPath, useDefaults, onUseDefaults, matchHeight,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  projectPath?: string;
  useDefaults: boolean;
  onUseDefaults: (v: boolean) => void;
  /** Cap the scroller so it lines up with the tools card beside it. */
  matchHeight?: number;
}) {
  const { data, isLoading } = useSWR(
    ["/api/skills", projectPath ?? "default"],
    () => Skills.list(projectPath),
  );
  const skills = data?.skills ?? [];
  const selected = new Set(value);

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
      <p className="-mt-1 text-[11px] text-muted-fg">{t("agents_form.skills_use_defaults_hint")}</p>

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
          {skills.map((s) => {
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
