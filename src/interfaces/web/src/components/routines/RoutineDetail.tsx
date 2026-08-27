import { Pencil, Play, Trash2, Zap } from "lucide-react";
import useSWR from "swr";
import { Agents } from "../../lib/api";
import type { RoutineEntry } from "../../lib/api";
import { AgentAvatar } from "../agents/AgentAvatar";
import { Badge, Button, Switch, Tip } from "../ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText, toneTint } from "../../lib/tone";
import { kindMeta, scheduleHuman } from "./shared";
import { relativeWhen } from "../../lib/when";
import { ReadOnlyBlock } from "../ReadOnlyBlock";
import { ExecutionsList } from "./ExecutionsList";

// Right column: read-only detail of the selected routine. Two stacked areas —
// the data (header + meta + content blocks) takes the space it needs, and the
// executions list below fills the rest and scrolls. Editing is behind a button.
export function RoutineDetail({
  pid, routine, onEdit, onRun, onToggle, onDelete, running,
}: {
  pid: string;
  routine: RoutineEntry;
  onEdit: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  running?: boolean;
}) {
  const meta = kindMeta()[routine.kind];
  const Icon = meta?.icon || Zap;
  const spec = (routine.spec || {}) as Record<string, any>;
  // Which agent actually runs this. The header used to say "Project agent" and
  // stop there, so a project with four routines showed the same label four
  // times and you had to open the editor to find out who each one belonged to.
  const agentSlug = routine.kind === "exec_agent" ? String(spec.agent || "") : "";
  const roster = useSWR(agentSlug ? `/api/projects/${pid}/agents` : null, () => Agents.list(pid));
  const runner = agentSlug ? (roster.data || []).find((a) => a.slug === agentSlug) : undefined;
  const pre = routine.pre_commands || [];
  const post = routine.post_commands || [];

  // Read-only content blocks, in pipeline order (pre → action → post).
  const blocks: { title: string; body: string; mono?: boolean }[] = [];
  if (pre.length) blocks.push({ title: t("project.routines.block_pre"), body: pre.join("\n"), mono: true });
  if (routine.kind === "exec_agent" || routine.kind === "super_agent" || routine.kind === "watch") {
    blocks.push({ title: t("project.routines.block_prompt"), body: String(spec.prompt || "") });
  } else if (routine.kind === "telegram") {
    blocks.push({ title: t("project.routines.block_text"), body: String(spec.text || "") });
  } else if (routine.kind === "shell") {
    blocks.push({ title: t("project.routines.block_command"), body: String(spec.command || ""), mono: true });
  } else if (routine.kind === "heartbeat") {
    blocks.push({ title: t("project.routines.block_text"), body: String(spec.message || "") });
  }
  if (post.length) blocks.push({ title: t("project.routines.block_post"), body: post.join("\n"), mono: true });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* DATA — takes the space it needs; scrolls only if it overflows */}
      <div className="min-h-0 shrink space-y-4 overflow-y-auto p-4">
        {/* header: name + actions (edit behind a button) */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", routine.enabled ? toneTint.emerald : "bg-muted text-muted-fg")}>
              <Icon size={14} />
            </span>
            <h3 className="truncate text-base font-semibold">{routine.name}</h3>
            {agentSlug ? (
              <Badge tone="info">
                <span className="flex items-center gap-1.5">
                  <AgentAvatar icon={runner?.icon} emoji={runner?.emoji} name={runner?.name || agentSlug} size={16} />
                  <span className="truncate">{runner?.name || agentSlug}</span>
                </span>
              </Badge>
            ) : (
              <Badge tone={routine.kind === "shell" ? "warning" : "info"}>{meta?.label || routine.kind}</Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch checked={routine.enabled} onChange={onToggle} />
            <Tip content={t("common.run")}><Button size="sm" variant="secondary" onClick={onRun} loading={running}><Play size={13} /></Button></Tip>
            <Tip content={t("project.routines.edit_hint")}><Button size="sm" variant="secondary" onClick={onEdit}><Pencil size={13} /> {t("project.routines.edit_btn")}</Button></Tip>
            <Tip content={t("common.delete")}><Button size="sm" variant="destructive" onClick={onDelete}><Trash2 size={13} /></Button></Tip>
          </div>
        </div>

        {/* compact meta: schedule / next / last */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
          <span title={routine.schedule}>⏱ {scheduleHuman(routine.schedule)}</span>
          {/* "in 8 hours" answers the question; the absolute time is one hover
              away for when the exact minute matters. Two full timestamps side
              by side made the row unreadable and still needed mental arithmetic. */}
          {routine.next_run_at && (
            <span title={new Date(routine.next_run_at).toLocaleString()}>
              {t("project.routines.next_run")} {relativeWhen(routine.next_run_at, t as never)}
            </span>
          )}
          {routine.last_run_at && (
            <span title={new Date(routine.last_run_at).toLocaleString()}>
              {t("project.routines.last_run")} {relativeWhen(routine.last_run_at, t as never)}
            </span>
          )}
          <span className={cn(routine.last_status === "ok" && toneText.emerald, routine.last_status === "error" && "text-destructive")}>
            {t("agents_ui.last_label")} {routine.last_status || "—"}
          </span>
        </div>
        {routine.last_error && <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{routine.last_error}</div>}

        {/* read-only content blocks */}
        <div className="space-y-3">
          {blocks.map((b) => <ReadOnlyBlock key={b.title} title={b.title} body={b.body} mono={b.mono} />)}
        </div>
      </div>

      {/* EXECUTIONS — fills the remaining height and scrolls. It reads the run
          in flight from the daemon rather than from this component's `running`
          prop, so it also shows a run the SCHEDULER started, and survives a
          refresh. `running` here only drives the Play button's own spinner. */}
      <ExecutionsList pid={pid} name={routine.name} />
    </div>
  );
}
