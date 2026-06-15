import { Pencil, Play, Trash2, Zap } from "lucide-react";
import type { RoutineEntry } from "../../lib/api";
import { Badge, Button, Switch, Tip } from "../ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { kindMeta, scheduleHuman } from "./shared";
import { ReadOnlyBlock } from "./ReadOnlyBlock";
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
  const pre = routine.pre_commands || [];
  const post = routine.post_commands || [];

  // Read-only content blocks, in pipeline order (pre → action → post).
  const blocks: { title: string; body: string; mono?: boolean }[] = [];
  if (pre.length) blocks.push({ title: t("project.routines.block_pre"), body: pre.join("\n"), mono: true });
  if (routine.kind === "exec_agent" || routine.kind === "super_agent") {
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
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", routine.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-fg")}>
              <Icon size={14} />
            </span>
            <h3 className="truncate text-base font-semibold">{routine.name}</h3>
            <Badge tone={routine.kind === "shell" ? "warning" : "info"}>{meta?.label || routine.kind}</Badge>
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
          <span>⏱ {scheduleHuman(routine.schedule)}</span>
          {routine.next_run_at && <span>{t("project.routines.next_run")} {new Date(routine.next_run_at).toLocaleString()}</span>}
          {routine.last_run_at && <span>{t("project.routines.last_run")} {new Date(routine.last_run_at).toLocaleString()}</span>}
          <span className={cn(routine.last_status === "ok" && "text-emerald-500", routine.last_status === "error" && "text-destructive")}>
            {t("agents_ui.last_label")} {routine.last_status || "—"}
          </span>
        </div>
        {routine.last_error && <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{routine.last_error}</div>}

        {/* read-only content blocks */}
        <div className="space-y-3">
          {blocks.map((b) => <ReadOnlyBlock key={b.title} title={b.title} body={b.body} mono={b.mono} />)}
        </div>
      </div>

      {/* EXECUTIONS — fills the remaining height and scrolls */}
      <ExecutionsList pid={pid} name={routine.name} running={running} />
    </div>
  );
}
