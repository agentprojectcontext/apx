import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowRight, Bot, Crown, Heart, Play, Plus, Send, Terminal, Trash2, Zap } from "lucide-react";
import { Routines, Agents, type RoutineEntry } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

function splitLines(v: string): string[] {
  return v.split("\n").map((s) => s.trim()).filter(Boolean);
}

type Kind = RoutineEntry["kind"];

// Friendly action types (maps to routines.js kinds).
function kindMeta(): Record<Kind, { label: string; desc: string; icon: typeof Bot }> {
  return {
    exec_agent:  { label: t("agents_ui.kind_exec_agent"),  desc: t("agents_ui.kind_exec_agent_desc"), icon: Bot },
    super_agent: { label: t("agents_ui.kind_super_agent"), desc: t("agents_ui.kind_super_agent_desc"), icon: Crown },
    telegram:    { label: t("agents_ui.kind_telegram"),    desc: t("agents_ui.kind_telegram_desc"), icon: Send },
    shell:       { label: t("agents_ui.kind_shell"),       desc: t("agents_ui.kind_shell_desc"), icon: Terminal },
    heartbeat:   { label: t("agents_ui.kind_heartbeat"),   desc: t("agents_ui.kind_heartbeat_desc"), icon: Heart },
  };
}
function kindOptions() {
  const meta = kindMeta();
  return (Object.keys(meta) as Kind[]).map((k) => ({ value: k, label: meta[k].label, description: meta[k].desc, icon: meta[k].icon }));
}

// "every:10m" → "cada 10 minutos", cron/once → legible.
function scheduleHuman(s?: string): string {
  if (!s) return "—";
  if (s.startsWith("every:")) {
    const v = s.slice(6);
    const m = v.match(/^(\d+)(s|m|h|d)$/);
    if (m) {
      const n = m[1];
      const unit = {
        s: t("agents_ui.unit_seconds"),
        m: t("agents_ui.unit_minutes"),
        h: t("agents_ui.unit_hours"),
        d: t("agents_ui.unit_days"),
      }[m[2]] || m[2];
      return t("agents_ui.every_n_unit", { n, unit });
    }
    return t("agents_ui.every_v", { v });
  }
  if (s.startsWith("once:")) return `once · ${new Date(s.slice(5)).toLocaleString()}`;
  if (s.startsWith("cron ")) return `cron · ${s.slice(5)}`;
  return s;
}

function schedPresets() {
  return [
    { label: t("agents_ui.preset_every_10m"), value: "every:10m" },
    { label: t("agents_ui.preset_hourly"), value: "every:1h" },
    { label: t("agents_ui.preset_daily_9am"), value: "cron 0 9 * * *" },
    { label: t("agents_ui.preset_weekdays_9am"), value: "cron 0 9 * * 1-5" },
  ];
}

// Template/env vars the routine runner exposes (src/core/routines/runner.js).
function routineVars() {
  return [
    { v: "{{pre_output}}", where: "prompt", desc: t("agents_ui.var_pre_output_prompt") },
    { v: "$APX_LLM_OUTPUT", where: "post", desc: t("agents_ui.var_llm_output") },
    { v: "$APX_STATUS", where: "post", desc: t("agents_ui.var_status") },
    { v: "$APX_SKIPPED", where: "post", desc: t("agents_ui.var_skipped") },
    { v: "$APX_PRE_OUTPUT", where: "post", desc: t("agents_ui.var_pre_output") },
    { v: "$APX_PRE_OUTPUT_FILE", where: "post", desc: t("agents_ui.var_pre_output_file") },
    { v: "$APX_PRE_EXIT", where: "post", desc: t("agents_ui.var_pre_exit") },
    { v: "$APX_ROUTINE", where: "pre/post", desc: t("agents_ui.var_routine") },
  ];
}

function actionSummary(kind: Kind, spec: Record<string, unknown>): string {
  switch (kind) {
    case "exec_agent": return spec.agent ? t("agents_ui.summary_runs_agent", { agent: String(spec.agent) }) : t("agents_ui.summary_runs_agent_none");
    case "super_agent": return t("agents_ui.summary_super_agent");
    case "telegram": return t("agents_ui.summary_telegram", { channel: String(spec.channel || "default") });
    case "shell": return spec.command ? t("agents_ui.summary_runs_cmd", { cmd: String(spec.command).slice(0, 40) }) : t("agents_ui.summary_shell");
    case "heartbeat": return t("agents_ui.summary_heartbeat");
  }
}

export function RoutinesTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/routines`, () => Routines.list(pid));
  const [editing, setEditing] = useState<Partial<RoutineEntry> | null>(null);

  const toggle = async (r: RoutineEntry) => {
    try { await (r.enabled ? Routines.disable : Routines.enable)(pid, r.name); list.mutate(); }
    catch (e: any) { toast.error(e?.message || t("project.routines.toggle_error")); }
  };
  const runNow = async (r: RoutineEntry) => {
    try { await Routines.run(pid, r.name); toast.success(t("project.routines.run_success", { name: r.name })); }
    catch (e: any) { toast.error(e?.message || t("project.routines.run_error")); }
  };
  const remove = async (r: RoutineEntry) => {
    if (!confirm(t("project.routines.delete_confirm", { name: r.name }))) return;
    try { await Routines.remove(pid, r.name); toast.success(t("project.routines.delete_success")); list.mutate(); }
    catch (e: any) { toast.error(e?.message || t("project.routines.delete_error")); }
  };

  return (
    <Section
      title={t("project.routines.title")}
      description={t("project.routines.subtitle")}
      action={<Button size="sm" variant="primary" onClick={() => setEditing({ kind: "super_agent", schedule: "every:10m", enabled: true })}>
        <Plus size={14} /> {t("project.routines.new_btn")}
      </Button>}
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>{t("project.routines.empty")}</Empty>}
      <ul className="space-y-2 text-sm">
        {(list.data || []).map((row) => {
          const meta = kindMeta()[row.kind];
          const Icon = meta?.icon || Zap;
          const err = row.last_status === "error";
          return (
            <li
              key={row.name}
              className="cursor-pointer rounded-xl border border-border bg-muted/30 p-3 hover:border-muted-fg/50"
              onClick={() => setEditing({ ...row })}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={cn("flex size-7 items-center justify-center rounded-lg", row.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-fg")}>
                    <Icon size={14} />
                  </span>
                  <span className="font-medium">{row.name}</span>
                  <Badge tone={row.kind === "shell" ? "warning" : "info"}>{meta?.label || row.kind}</Badge>
                  {!row.enabled && <Badge tone="muted">{t("project.routines.paused")}</Badge>}
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={row.enabled} onChange={() => toggle(row)} />
                  <Button size="sm" variant="secondary" onClick={() => runNow(row)}><Play size={13} /> {t("common.run")}</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(row)}><Trash2 size={13} /></Button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
                <span>⏱ {scheduleHuman(row.schedule)}</span>
                <span>{actionSummary(row.kind, row.spec || {})}</span>
                {row.next_run_at && <span>{t("project.routines.next_run")} {new Date(row.next_run_at).toLocaleString()}</span>}
                <span className={cn(row.last_status === "ok" && "text-emerald-500", err && "text-destructive")}>
                  {t("agents_ui.last_label")} {row.last_status || "—"}
                </span>
              </div>
              {row.last_error && <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{row.last_error}</div>}
            </li>
          );
        })}
      </ul>

      <RoutineEditor
        draft={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); list.mutate(); }}
        pid={pid}
      />
    </Section>
  );
}

function RoutineEditor({
  draft, onClose, onSaved, pid,
}: { draft: Partial<RoutineEntry> | null; onClose: () => void; onSaved: () => void; pid: string }) {
  const toast = useToast();
  const agentsList = useSWR(draft ? `/projects/${pid}/agents` : null, () => Agents.list(pid));
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("super_agent");
  const [schedule, setSchedule] = useState("every:10m");
  const [enabled, setEnabled] = useState(true);
  // Per-kind fields
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tgChannel, setTgChannel] = useState("default");
  const [tgChatId, setTgChatId] = useState("");
  const [tgText, setTgText] = useState("");
  const [command, setCommand] = useState("");
  const [hbChannel, setHbChannel] = useState("heartbeat");
  const [hbMessage, setHbMessage] = useState("");
  const [pre, setPre] = useState("");
  const [post, setPost] = useState("");

  // Load draft → fields.
  useEffect(() => {
    if (!draft) return;
    const spec = (draft.spec && typeof draft.spec === "object" ? draft.spec : {}) as Record<string, any>;
    setName(draft.name || "");
    setKind((draft.kind as Kind) || "super_agent");
    setSchedule(draft.schedule || "every:10m");
    setEnabled(draft.enabled ?? true);
    setAgent(spec.agent || "");
    setPrompt(spec.prompt || "");
    setTgChannel(spec.channel || "default");
    setTgChatId(spec.chat_id ? String(spec.chat_id) : "");
    setTgText(spec.text || "");
    setCommand(spec.command || "");
    setHbChannel(spec.channel || "heartbeat");
    setHbMessage(spec.message || "");
    setPre((draft.pre_commands || []).join("\n"));
    setPost((draft.post_commands || []).join("\n"));
  }, [draft]);

  const buildSpec = (): Record<string, unknown> => {
    switch (kind) {
      case "exec_agent": return { agent, prompt };
      case "super_agent": return { prompt };
      case "telegram": return { channel: tgChannel, ...(tgChatId ? { chat_id: tgChatId } : {}), text: tgText };
      case "shell": return { command };
      case "heartbeat": return { channel: hbChannel, message: hbMessage };
    }
  };

  const submit = async () => {
    if (!name) { toast.error(t("project.routines.name_required")); return; }
    setBusy(true);
    try {
      const usePP = kind === "exec_agent" || kind === "super_agent";
      await Routines.upsert(pid, {
        name, kind, schedule, enabled,
        spec: buildSpec(),
        pre_commands: usePP ? splitLines(pre) : [],
        post_commands: usePP ? splitLines(post) : [],
      });
      toast.success(t("project.routines.saved"));
      onSaved();
    } catch (e: any) { toast.error(e?.message || t("project.routines.save_error")); }
    finally { setBusy(false); }
  };

  // Only the LLM kinds wrap the action with pre/post shell commands.
  const usesPrePost = kind === "exec_agent" || kind === "super_agent";
  // Timeline steps (pre → action → post).
  const preSteps = usesPrePost ? splitLines(pre) : [];
  const postSteps = usesPrePost ? splitLines(post) : [];
  const actionLabel = (() => {
    switch (kind) {
      case "exec_agent": return agent ? t("agents_ui.action_agent_answers", { agent }) : t("agents_ui.action_agent_pick_answers");
      case "super_agent": return t("agents_ui.action_super_answers");
      case "telegram": return t("agents_ui.action_telegram_channel", { channel: tgChannel });
      case "shell": return command ? t("agents_ui.summary_runs_cmd", { cmd: command.slice(0, 48) }) : t("agents_ui.action_runs_shell");
      case "heartbeat": return t("agents_ui.summary_heartbeat");
    }
  })();
  const usesPrompt = usesPrePost;

  const ActionIcon = kindMeta()[kind].icon;
  const steps = [
    ...preSteps.map((c, i) => ({ id: `pre-${i}`, icon: Terminal, label: t("agents_ui.step_pre"), detail: c, action: false })),
    { id: "action", icon: ActionIcon, label: actionLabel, detail: usesPrompt && prompt ? prompt.slice(0, 90) : undefined, action: true },
    ...postSteps.map((c, i) => ({ id: `post-${i}`, icon: Terminal, label: t("agents_ui.step_post"), detail: c, action: false })),
  ];

  return (
    <Dialog
      open={!!draft}
      onClose={onClose}
      title={draft?.name ? t("project.routines.edit_title", { name: draft.name }) : t("project.routines.new_title")}
      description={t("project.routines.dialog_desc")}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* status */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
          <Switch checked={enabled} onChange={setEnabled} label={t("project.routines.enabled_label")} />
          <span className="text-[11px] text-muted-fg">{enabled ? t("project.routines.enabled_hint") : t("project.routines.disabled_hint")}</span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* LEFT — qué y cuándo */}
          <div className="space-y-3">
            <Field label={t("project.routines.name_field")} hint={draft?.name ? t("project.routines.name_no_edit") : undefined}>
              <Input value={name} disabled={!!draft?.name} onChange={(e) => setName(e.target.value)} placeholder="resumen-diario" />
            </Field>
            <Field label={t("project.routines.kind_field")}>
              <UiSelect value={kind} onChange={(v) => setKind(v as Kind)} options={kindOptions()} />
            </Field>
            <p className="-mt-1 text-[11px] text-muted-fg">{kindMeta()[kind].desc}</p>
            {kind === "exec_agent" && (
              <Field label={t("project.routines.agent_field")} hint={t("project.routines.agent_hint")}>
                <UiSelect value={agent} onChange={setAgent} placeholder={agentsList.isLoading ? t("project.routines.agent_loading") : t("project.routines.agent_pick")}
                  options={(agentsList.data || []).map((a) => ({ value: a.slug, label: a.slug, description: [a.role, a.model].filter(Boolean).join(" · ") || undefined }))} />
              </Field>
            )}
            <Field label={t("project.routines.schedule_field")} hint={t("project.routines.schedule_hint")}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {schedPresets().map((s) => (
                    <button key={s.value} type="button" onClick={() => setSchedule(s.value)}
                      className={cn("rounded-md border px-2 py-0.5 text-[11px]", schedule === s.value ? "border-emerald-500/50 text-emerald-400" : "border-border text-muted-fg hover:text-foreground")}>
                      {s.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setSchedule("manual")}
                    className={cn("rounded-md border px-2 py-0.5 text-[11px]", schedule === "manual" ? "border-emerald-500/50 text-emerald-400" : "border-border text-muted-fg hover:text-foreground")}>
                    {t("agents_ui.preset_manual")}
                  </button>
                </div>
                <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="every:10m · cron 0 9 * * 1-5 · once:ISO · manual" />
              </div>
            </Field>
          </div>

          {/* RIGHT — lo que ejecuta, según el tipo */}
          <div className="space-y-3">
            {/* LLM: pre → prompt → post */}
            {usesPrePost && (
              <Field label={t("project.routines.pre_field")} hint={t("project.routines.pre_hint")}>
                <Textarea rows={2} className="font-mono text-xs" value={pre} onChange={(e) => setPre(e.target.value)} placeholder="curl -s https://wttr.in/Bariloche" />
              </Field>
            )}
            {kind === "exec_agent" && (
              <Field label={t("project.routines.prompt_exec")}><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("project.routines.prompt_exec_ph")} /></Field>
            )}
            {kind === "super_agent" && (
              <Field label={t("project.routines.prompt_super")}><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("project.routines.prompt_super_ph")} /></Field>
            )}

            {/* Telegram: solo manda un mensaje (sin LLM) */}
            {kind === "telegram" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("project.routines.tg_channel")}><Input value={tgChannel} onChange={(e) => setTgChannel(e.target.value)} placeholder="default" /></Field>
                  <Field label={t("project.routines.tg_chat_id")}><Input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder={t("agents_ui.tg_chat_id_ph")} /></Field>
                </div>
                <Field label={t("project.routines.tg_text")} hint={t("project.routines.tg_text_hint")}>
                  <Textarea rows={8} value={tgText} onChange={(e) => setTgText(e.target.value)} placeholder={t("agents_ui.tg_text_ph")} />
                </Field>
              </>
            )}

            {/* Shell: un comando, ocupando todo */}
            {kind === "shell" && (
              <Field label={t("project.routines.shell_field")} hint={t("project.routines.shell_hint")}>
                <Textarea rows={11} className="font-mono text-xs" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="cd /repo && git pull && npm test" />
              </Field>
            )}

            {/* Heartbeat: solo loguea */}
            {kind === "heartbeat" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("project.routines.hb_channel")}><Input value={hbChannel} onChange={(e) => setHbChannel(e.target.value)} placeholder="heartbeat" /></Field>
                <Field label={t("project.routines.hb_message")}><Input value={hbMessage} onChange={(e) => setHbMessage(e.target.value)} placeholder={t("agents_ui.hb_message_ph")} /></Field>
              </div>
            )}

            {usesPrePost && (
              <Field label={t("project.routines.post_field")} hint={t("project.routines.post_hint")}>
                <Textarea rows={2} className="font-mono text-xs" value={post} onChange={(e) => setPost(e.target.value)} placeholder={'apx telegram send "$APX_LLM_OUTPUT"'} />
              </Field>
            )}
          </div>
        </div>

        {/* Variables disponibles */}
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t("project.routines.vars_title")}</div>
          <div className="flex flex-wrap gap-1.5">
            {routineVars().map((v) => (
              <span key={v.v} title={v.desc} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">
                {v.v}<span className="not-italic text-muted-fg">· {v.where}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Qué va a pasar — full width */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-semibold text-muted-fg">{t("project.routines.what_happens")} <span className="font-normal text-muted-fg">· ⏱ {scheduleHuman(schedule)}</span></div>
          <div className="flex flex-wrap items-stretch gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-stretch gap-2">
                <div className={cn("flex max-w-[240px] flex-col gap-1 rounded-lg border px-2.5 py-2", s.action ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card")}>
                  <div className={cn("flex items-center gap-1.5 text-[11px] font-medium", s.action ? "text-emerald-400" : "text-muted-fg")}>
                    <s.icon size={12} /> {s.label}
                  </div>
                  {s.detail && <div className="line-clamp-2 font-mono text-[10px] text-muted-fg">{s.detail}</div>}
                </div>
                {i < steps.length - 1 && <ArrowRight size={14} className="shrink-0 self-center text-muted-fg" />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
