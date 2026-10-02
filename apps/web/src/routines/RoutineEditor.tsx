import type { CallModel, Schedule } from "@apx/protocol";
import { AgentAvatar, Button, Dialog, Icons, Input, Menu, SegmentedControl, Textarea } from "@apx/ui";
import { useState } from "react";
import { aheadLabel } from "../common/format.ts";
import { blobOf } from "../data/identity.ts";
import { type RoutineDraft, saveRoutine } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, type T, useT } from "../i18n/index.ts";

/** Ready-made times; any other five-field cron can be typed. */
const PRESETS = [
  { cron: "0 9 * * *", key: "routines.preset.daily" },
  { cron: "30 8 * * 1-5", key: "routines.preset.weekdays" },
  { cron: "0 9 * * 1", key: "routines.preset.mondays" },
  { cron: "0 * * * *", key: "routines.preset.hourly" },
] as const;

export function scheduleText(s: Schedule, t: T): string {
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
          {current && <AgentAvatar name={current.name} blob={blobOf(current)} size={16} animated={false} />}
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

export function RoutineEditor({ draft, onClose }: { draft: RoutineDraft; onClose: () => void }) {
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
        <PipelineFields draft={d} onChange={(p) => setD({ ...d, ...p })} />
      </div>
    </Dialog>
  );
}

const CALL_MODEL: Array<{ value: CallModel; key: MessageKey }> = [
  { value: "always", key: "routines.call.always" },
  { value: "output", key: "routines.call.output" },
  { value: "fails", key: "routines.call.fails" },
  { value: "never", key: "routines.call.never" },
];

/**
 * The commands around the agent: a pre-command whose output the agent reads ({{pre_output}}), when to call the
 * model given that output, and a post-command after. Folded until the routine has one.
 */
function PipelineFields({ draft: d, onChange }: { draft: RoutineDraft; onChange: (p: Partial<RoutineDraft>) => void }) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(d.pre_command || d.post_command));
  if (!open)
    return (
      <Button
        variant="ghost"
        size="sm"
        className="pipeline__add"
        leadingIcon={<Icons.Terminal size={14} />}
        onClick={() => setOpen(true)}
      >
        {t("routines.addCommands")}
      </Button>
    );
  return (
    <fieldset className="pipeline">
      <legend className="pform__label">{t("routines.commands")}</legend>
      <p className="pform__hint">{t("routines.commandsHint")}</p>
      <div className="pipeline__step">
        <span className="pipeline__dot">1</span>
        <div className="pform__field">
          <span className="pform__label">{t("routines.pre")}</span>
          <Textarea
            className="pipeline__cmd"
            aria-label={t("routines.pre")}
            placeholder="gh pr list --state open --json title,url"
            rows={2}
            value={d.pre_command}
            onChange={(e) => onChange({ pre_command: e.currentTarget.value })}
          />
          <span className="pform__hint">{t("routines.preHint")}</span>
        </div>
      </div>
      <div className="pipeline__step">
        <span className="pipeline__dot">2</span>
        <div className="pform__field">
          <span className="pform__label">{t("routines.callModel")}</span>
          <SegmentedControl
            size="sm"
            label={t("routines.callModel")}
            value={d.call_model}
            onValueChange={(v) => onChange({ call_model: v as CallModel })}
            options={CALL_MODEL.map((c) => ({ value: c.value, label: t(c.key) }))}
          />
        </div>
      </div>
      <div className="pipeline__step">
        <span className="pipeline__dot">3</span>
        <div className="pform__field">
          <span className="pform__label">{t("routines.post")}</span>
          <Textarea
            className="pipeline__cmd"
            aria-label={t("routines.post")}
            placeholder={'echo "$APX_LLM_OUTPUT" >> report.md'}
            rows={2}
            value={d.post_command}
            onChange={(e) => onChange({ post_command: e.currentTarget.value })}
          />
          <span className="pform__hint">{t("routines.postHint")}</span>
        </div>
      </div>
    </fieldset>
  );
}
