import type { CallModel, RoutineAction } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, SegmentedControl, Select, SuggestTextarea, Switch } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { secretary } from "../data/identity.ts";
import { type RoutineDraft, saveRoutine } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { ScheduleEditor, scheduleText } from "./Schedule.tsx";
import { postVars, promptVars } from "./vars.ts";

const ACTIONS: Array<{ value: RoutineAction; key: MessageKey; hint: MessageKey; icon: typeof Icons.Bot }> = [
  { value: "agent", key: "routines.action.agent", hint: "routines.action.agentHint", icon: Icons.Bot },
  { value: "message", key: "routines.action.message", hint: "routines.action.messageHint", icon: Icons.Send },
  { value: "shell", key: "routines.action.shell", hint: "routines.action.shellHint", icon: Icons.Terminal },
  { value: "watch", key: "routines.action.watch", hint: "routines.action.watchHint", icon: Icons.Eye },
];

/** "Go on" after the pre-command: always, only if it printed something, only if it failed, never. */
const CONDITIONS: Array<{ value: CallModel; key: MessageKey }> = [
  { value: "always", key: "routines.call.always" },
  { value: "output", key: "routines.call.output" },
  { value: "fails", key: "routines.call.fails" },
  { value: "never", key: "routines.call.never" },
];

/**
 * Creating and editing a routine are the same dialog: on the left what it is (name, action, who, when), on the right
 * its flow — before, the action, after — with the variables each step can use offered as you type "$" or "{{", and
 * what will happen in one line.
 */
export function RoutineEditor({ draft, onClose }: { draft: RoutineDraft; onClose: () => void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [d, setD] = useState(draft);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<RoutineDraft>) => setD((cur) => ({ ...cur, ...p }));
  const shell = d.action === "shell";
  const watch = d.action === "watch";
  // A new watcher starts from a prompt that says what to look for; the owner's own words are never replaced.
  const pickAction = (action: RoutineAction) =>
    set(action === "watch" && !d.prompt.trim() ? { action, prompt: t("routines.watchPrompt") } : { action });
  // Without a pick, the super-agent: it signs a message or shell job and answers an agent routine.
  const agent = d.agent || (secretary(agents)?.id ?? "");
  const text = shell ? d.prompt || d.name : d.prompt;
  const ok = Boolean(d.name.trim() && agent && (shell ? d.pre_command.trim() : d.prompt.trim()));
  const save = async () => {
    setSaving(true);
    const saved = await saveRoutine({ ...d, agent, name: d.name.trim(), prompt: text.trim() });
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog
      open
      size="xl"
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
      <div className="rtedit">
        <div className="rtedit__form">
          <div className="taskform__row">
            <Field label={t("routines.name")}>
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  placeholder={t("routines.namePlaceholder")}
                  value={d.name}
                  onChange={(e) => set({ name: e.currentTarget.value })}
                />
              )}
            </Field>
            <Field label={t("routines.state")}>
              <Switch
                checked={d.enabled}
                label={d.enabled ? t("routines.on") : t("routines.off")}
                onCheckedChange={(enabled) => set({ enabled })}
              />
            </Field>
          </div>
          <Field label={t("routines.action")}>
            <Select
              label={t("routines.action")}
              value={d.action}
              onValueChange={(v) => v && pickAction(v as RoutineAction)}
              options={ACTIONS.map((a) => ({
                value: a.value,
                label: t(a.key),
                description: t(a.hint),
                icon: <a.icon size={14} />,
              }))}
            />
          </Field>
          {(d.action === "agent" || watch) && (
            <Field label={t("routines.agent")}>
              <AgentSelect
                value={agent || undefined}
                projectId={d.project}
                onChange={(id) => id && set({ agent: id })}
              />
            </Field>
          )}
          <Field label={t("routines.when")}>
            <ScheduleEditor value={d.schedule} onChange={(schedule) => set({ schedule })} />
          </Field>
          {!shell && (
            <Field label={t("routines.anchor")} hint={t("routines.anchorHint")}>
              <Switch checked={d.anchor} label={t("routines.anchor")} onCheckedChange={(anchor) => set({ anchor })} />
            </Field>
          )}
          {d.pre_command.trim() && !shell && !watch && (
            <Field label={d.action === "message" ? t("routines.sendWhen") : t("routines.callModel")}>
              <SegmentedControl
                size="sm"
                label={t("routines.callModel")}
                value={d.call_model}
                onValueChange={(v) => set({ call_model: v as CallModel })}
                options={CONDITIONS.map((c) => ({ value: c.value, label: t(c.key) }))}
              />
            </Field>
          )}
        </div>

        <div className="rtedit__flow">
          <Step
            n={1}
            title={shell ? t("routines.step.command") : t("routines.step.before")}
            hint={t(shell ? "routines.step.commandHint" : "routines.step.beforeHint")}
          >
            <SuggestTextarea
              className="rtedit__code"
              aria-label={t("routines.pre")}
              rows={shell ? 4 : 2}
              placeholder={shell ? "tar czf backup.tgz notes/" : "curl -s https://wttr.in/?format=3"}
              value={d.pre_command}
              onValueChange={(pre_command) => set({ pre_command })}
              suggestions={[]}
            />
          </Step>
          {!shell && (
            <Step n={2} title={t(STEP_KEY[d.action].title)} hint={t(STEP_KEY[d.action].hint)}>
              <SuggestTextarea
                aria-label={t("routines.prompt")}
                rows={5}
                placeholder={d.action === "message" ? t("routines.messagePlaceholder") : t("routines.promptHint")}
                value={d.prompt}
                onValueChange={(prompt) => set({ prompt })}
                suggestions={promptVars(t)}
              />
            </Step>
          )}
          <Step n={shell ? 2 : 3} title={t("routines.step.after")} hint={t("routines.step.afterHint")}>
            <SuggestTextarea
              className="rtedit__code"
              aria-label={t("routines.post")}
              rows={2}
              placeholder={'echo "$APX_LLM_OUTPUT" >> report.md'}
              value={d.post_command}
              onValueChange={(post_command) => set({ post_command })}
              suggestions={postVars(t)}
            />
          </Step>
          <p className="rtedit__summary">
            <Icons.Clock size={13} />
            {summary(d, t, agents[agent]?.name ?? "")}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rtedit__step">
      <header className="rtedit__stephead">
        <span className="rtedit__stepn">{n}</span>
        <span className="rtedit__steptitle">{title}</span>
        <span className="rtedit__stephint">{hint}</span>
      </header>
      {children}
    </section>
  );
}

const STEP_KEY: Record<RoutineAction, { title: MessageKey; hint: MessageKey }> = {
  agent: { title: "routines.step.agent", hint: "routines.step.agentHint" },
  message: { title: "routines.step.message", hint: "routines.step.messageHint" },
  shell: { title: "routines.step.command", hint: "routines.step.commandHint" },
  watch: { title: "routines.step.watch", hint: "routines.step.watchHint" },
};

const SUM_COND: Record<CallModel, MessageKey> = {
  always: "routines.sum.cond.always",
  output: "routines.sum.cond.output",
  fails: "routines.sum.cond.fails",
  never: "routines.sum.cond.never",
};

/** "Weekdays at 08:30: runs the command, then Roby answers if it printed something, then the after-command." */
function summary(d: RoutineDraft, t: ReturnType<typeof useT>, agent: string): string {
  const when = scheduleText(d.schedule, t);
  const parts: string[] = [];
  const pre = d.pre_command.trim();
  if (pre && d.action !== "shell") parts.push(t("routines.sum.pre"));
  if (d.action === "shell") parts.push(t("routines.sum.shell"));
  else if (d.action === "watch") parts.push(t("routines.sum.watch", { agent: agent || t("routines.agent") }));
  else {
    const cond = pre ? t(SUM_COND[d.call_model]) : "";
    parts.push(
      d.action === "message"
        ? t("routines.sum.message", { cond })
        : t("routines.sum.agent", { agent: agent || t("routines.agent"), cond }),
    );
  }
  if (d.post_command.trim()) parts.push(t("routines.sum.post"));
  return `${when}: ${parts.join(" → ")}`;
}
