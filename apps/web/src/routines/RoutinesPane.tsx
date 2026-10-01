import type { Routine, RoutineRun, Schedule } from "@apx/protocol";
import {
  AgentAvatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Icons,
  Input,
  Menu,
  SegmentedControl,
  Switch,
  Textarea,
} from "@apx/ui";
import { useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { aheadLabel, shortWhen } from "../common/format.ts";
import { loadThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PID } from "../data/identity.ts";
import {
  draftOf,
  loadRoutines,
  type RoutineDraft,
  removeRoutine,
  routineRuns,
  runRoutine,
  saveRoutine,
  useRoutines,
} from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";

/** Ready-made times; any other five-field cron can be typed. */
const PRESETS = [
  { cron: "0 9 * * *", key: "routines.preset.daily" },
  { cron: "30 8 * * 1-5", key: "routines.preset.weekdays" },
  { cron: "0 9 * * 1", key: "routines.preset.mondays" },
  { cron: "0 * * * *", key: "routines.preset.hourly" },
] as const;

function scheduleText(s: Schedule, t: T): string {
  switch (s.kind) {
    case "cron": {
      const preset = PRESETS.find((p) => p.cron === s.cron);
      return preset ? t(preset.key) : `cron ${s.cron}`;
    }
    case "every":
      return t("routines.everyN", { n: s.minutes });
    case "once":
      return t("routines.onceAt", { when: aheadLabel(s.at) });
    case "manual":
      return t("routines.manual");
  }
}

/** A project's routines (the base project shows the global ones). */
export function RoutinesPane({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const [editing, setEditing] = useState<RoutineDraft>();
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const global = projectId === DEFAULT_PID;
  const list = all.filter((r) => (global ? !r.project_id : r.project_id === projectId));
  const current = list.find((r) => r.id === open);
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(global ? {} : { project: projectId }),
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: "",
    enabled: true,
  };

  return (
    <div className="board">
      <div className="board__head">
        <p className="config__lead">{t("routines.lead")}</p>
        <span className="board__spacer" />
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing(blank)}>
          {t("routines.new")}
        </Button>
      </div>
      {ready && !list.length ? (
        <EmptyState variant="dashed" size="lg" icon={<Icons.Clock />} title={t("routines.emptyTitle")}>
          {t("routines.empty")}
        </EmptyState>
      ) : (
        <ul className="routines">
          {list.map((r) => (
            <RoutineRow key={r.id} routine={r} onOpen={() => setOpen(r.id)} onEdit={() => setEditing(draftOf(r))} />
          ))}
        </ul>
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
      {current && <RoutineDetail routine={current} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function RoutineRow({ routine: r, onOpen, onEdit }: { routine: Routine; onOpen: () => void; onEdit: () => void }) {
  const t = useT();
  const agent = useData((s) => s.agents[r.agent_id]);
  return (
    <li className="routine">
      <button type="button" className="routine__main" onClick={onOpen}>
        <span className="routine__name">{r.name}</span>
        <span className="taskcard__meta">
          {agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={16} />}
          <span>{scheduleText(r.schedule, t)}</span>
          {r.last && <LastRun run={r.last} />}
          <span className="taskcard__when">
            {!r.enabled
              ? t("routines.off")
              : r.next_run_at
                ? t("routines.next", { when: aheadLabel(r.next_run_at) })
                : r.schedule.kind === "manual"
                  ? ""
                  : t("routines.noNext")}
          </span>
        </span>
      </button>
      <Switch
        size="sm"
        checked={r.enabled}
        aria-label={t("routines.enabled")}
        onCheckedChange={(on) => void saveRoutine({ ...draftOf(r), enabled: on })}
      />
      <IconButton
        size="sm"
        label={t("routines.runNow")}
        icon={<Icons.Play size={14} />}
        onClick={() => void runRoutine(r.id)}
      />
      <Menu
        align="end"
        trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
        items={[
          { label: t("routines.edit"), icon: <Icons.Pencil size={14} />, onSelect: onEdit },
          {
            label: t("routines.remove"),
            icon: <Icons.Trash2 size={14} />,
            danger: true,
            onSelect: () => void removeRoutine(r.id),
          },
        ]}
      />
    </li>
  );
}

function LastRun({ run }: { run: RoutineRun }) {
  const t = useT();
  if (run.state === "failed")
    return (
      <Badge tone="danger" dot>
        {t("routines.failed")}
      </Badge>
    );
  if (run.state !== "completed" && run.state !== "canceled")
    return (
      <Badge tone="info" dot>
        {t("routines.running")}
      </Badge>
    );
  return <Badge>{run.delivered === false ? t("routines.quiet") : t("routines.told")}</Badge>;
}

function AgentPicker({
  value,
  projectId,
  onChange,
}: {
  value: string;
  projectId?: string | undefined;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const list = Object.values(agents).filter((a) => !a.project_id || a.project_id === projectId);
  const current = agents[value];
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
          {current && <AgentAvatar name={current.name} blob={blobOf(current)} size={16} />}
          {current?.name ?? t("routines.pickAgent")}
        </Button>
      }
      items={list.map((a) => ({ label: a.name, onSelect: () => onChange(a.id) }))}
    />
  );
}

/** `datetime-local` wants local time without a zone. */
const localInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function ScheduleEditor({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
  const t = useT();
  const tomorrow9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  const kinds: Record<Schedule["kind"], () => Schedule> = {
    cron: () => ({ kind: "cron", cron: "0 9 * * *" }),
    every: () => ({ kind: "every", minutes: 60 }),
    once: () => ({ kind: "once", at: tomorrow9() }),
    manual: () => ({ kind: "manual" }),
  };
  return (
    <div className="pform">
      <SegmentedControl
        size="sm"
        label={t("routines.when")}
        value={value.kind}
        onValueChange={(k) => k !== value.kind && onChange(kinds[k as Schedule["kind"]]())}
        options={[
          { value: "cron", label: t("routines.kind.cron") },
          { value: "every", label: t("routines.kind.every") },
          { value: "once", label: t("routines.kind.once") },
          { value: "manual", label: t("routines.kind.manual") },
        ]}
      />
      {value.kind === "cron" && (
        <div className="tgtoken">
          <Menu
            trigger={
              <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
                {scheduleText(value, t)}
              </Button>
            }
            items={PRESETS.map((p) => ({ label: t(p.key), onSelect: () => onChange({ kind: "cron", cron: p.cron }) }))}
          />
          <Input
            aria-label={t("routines.cron")}
            value={value.cron}
            onChange={(e) => onChange({ kind: "cron", cron: e.currentTarget.value })}
          />
        </div>
      )}
      {value.kind === "cron" && <span className="pform__hint">{t("routines.cronHint")}</span>}
      {value.kind === "every" && (
        <div className="tgtoken">
          <Input
            type="number"
            min={5}
            aria-label={t("routines.minutes")}
            value={String(value.minutes)}
            onChange={(e) => onChange({ kind: "every", minutes: Number(e.currentTarget.value) || 0 })}
          />
          <span className="pform__hint">{t("routines.minutes")}</span>
        </div>
      )}
      {value.kind === "once" && (
        <Input
          type="datetime-local"
          aria-label={t("routines.kind.once")}
          value={localInput(value.at)}
          onChange={(e) => {
            const d = new Date(e.currentTarget.value);
            if (!Number.isNaN(d.getTime())) onChange({ kind: "once", at: d.toISOString() });
          }}
        />
      )}
    </div>
  );
}

function RoutineEditor({ draft, onClose }: { draft: RoutineDraft; onClose: () => void }) {
  const t = useT();
  const [d, setD] = useState(draft);
  const [saving, setSaving] = useState(false);
  const ok = d.name.trim() && d.prompt.trim() && d.agent;
  const save = async () => {
    setSaving(true);
    const saved = await saveRoutine({ ...d, name: d.name.trim(), prompt: d.prompt.trim() });
    setSaving(false);
    if (saved) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={d.id ? t("routines.edit") : t("routines.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ok} loading={saving} onClick={() => void save()}>
            {t("routines.save")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <Input
          aria-label={t("routines.name")}
          placeholder={t("routines.name")}
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.currentTarget.value })}
        />
        <AgentPicker value={d.agent} projectId={d.project} onChange={(agent) => setD({ ...d, agent })} />
        <Textarea
          aria-label={t("routines.prompt")}
          placeholder={t("routines.promptHint")}
          rows={4}
          value={d.prompt}
          onChange={(e) => setD({ ...d, prompt: e.currentTarget.value })}
        />
        <ScheduleEditor value={d.schedule} onChange={(schedule) => setD({ ...d, schedule })} />
      </div>
    </Dialog>
  );
}

/** A routine: what it asks and its recent runs; a run opens its conversation. */
function RoutineDetail({ routine: r, onClose }: { routine: Routine; onClose: () => void }) {
  const t = useT();
  const [runs, setRuns] = useState<RoutineRun[]>();
  const [shown, setShown] = useState<string>();
  // Read again whenever the latest run starts or ends.
  const latest = `${r.last?.run_id}:${r.last?.state}:${r.last?.delivered}`;
  useEffect(() => {
    void routineRuns(r.id).then((list) => {
      if (!latest) return;
      setRuns(list);
      setShown((s) => s ?? list[0]?.thread_id);
    });
  }, [r.id, latest]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={r.name}>
      <div className="taskdetail">
        <p className="taskdetail__desc">{r.prompt}</p>
        <div className="routine__runs">
          {runs?.map((x) => (
            <button
              type="button"
              key={x.run_id}
              className={x.thread_id === shown ? "routine__run is-on" : "routine__run"}
              onClick={() => setShown(x.thread_id)}
            >
              <span>{shortWhen(x.started_at)}</span>
              <LastRun run={x} />
            </button>
          ))}
          {runs?.length === 0 && <span className="pform__hint">{t("routines.noRuns")}</span>}
        </div>
        {shown && <RunTranscript threadId={shown} />}
      </div>
    </Dialog>
  );
}

function RunTranscript({ threadId }: { threadId: string }) {
  const thread = useData((s) => s.threads[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  useEffect(() => {
    if (load == null) void loadThread(threadId);
  }, [load, threadId]);
  return <div className="taskdetail__chat">{thread && load === "ready" && <Transcript thread={thread} />}</div>;
}
