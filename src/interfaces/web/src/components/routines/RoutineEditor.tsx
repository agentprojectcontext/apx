import { useEffect, useState } from "react";
import useSWR from "swr";
import { ArrowRight, Terminal } from "lucide-react";
import { Routines, Agents, Telegram, type RoutineEntry } from "../../lib/api";
import { Button, Dialog, Field, Input, Switch, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { type Kind, kindMeta, kindOptions, schedPresets, scheduleHuman, splitLines, varsFor } from "./shared";
import { VarTextarea } from "./VarTextarea";

export function RoutineEditor({
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

  // Telegram channels for the selector (default + any project/global channels).
  const tgChannels = useSWR(draft && kind === "telegram" ? "/telegram/channels" : null, () => Telegram.channels.list());

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

  // Pre/post shell wrap the LLM kinds AND telegram (pre can fetch data, the text
  // can use {{pre_output}}, post can react to the result).
  const usesPrePost = kind === "exec_agent" || kind === "super_agent" || kind === "telegram";

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
      await Routines.upsert(pid, {
        name, kind, schedule, enabled,
        spec: buildSpec(),
        pre_commands: usesPrePost ? splitLines(pre) : [],
        post_commands: usesPrePost ? splitLines(post) : [],
      });
      toast.success(t("project.routines.saved"));
      onSaved();
    } catch (e: any) { toast.error(e?.message || t("project.routines.save_error")); }
    finally { setBusy(false); }
  };

  // Channel options: "default" + configured channels + the current value.
  const channelOptions = (() => {
    const list = tgChannels.data?.channels || [];
    const names = ["default", ...list.map((c) => c.name)];
    if (tgChannel && !names.includes(tgChannel)) names.push(tgChannel);
    const seen = new Set<string>();
    return names
      .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
      .map((n) => {
        const ch = list.find((c) => c.name === n);
        const description = ch?.project ? `proyecto ${ch.project}` : ch?.chat_id ? `chat ${ch.chat_id}` : undefined;
        return { value: n, label: n, description };
      });
  })();

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
  const actionDetail =
    kind === "telegram" ? tgText :
    kind === "shell" ? command :
    kind === "heartbeat" ? hbMessage :
    prompt;

  const ActionIcon = kindMeta()[kind].icon;
  const steps = [
    ...preSteps.map((c, i) => ({ id: `pre-${i}`, icon: Terminal, label: t("agents_ui.step_pre"), detail: c, action: false })),
    { id: "action", icon: ActionIcon, label: actionLabel, detail: actionDetail ? actionDetail.slice(0, 90) : undefined, action: true },
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
              <UiSelect value={kind} onChange={(v) => setKind(v as Kind)} options={kindOptions(kind)} />
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

          {/* RIGHT — lo que ejecuta, según el tipo. Cada textarea trae sus
              variables como chips clickeables debajo. */}
          <div className="space-y-3">
            {/* pre → action → post (las variables aparecen donde se usan) */}
            {usesPrePost && (
              <VarTextarea
                label={t("project.routines.pre_field")} hint={t("project.routines.pre_hint")}
                rows={2} mono value={pre} onChange={setPre} vars={varsFor("pre")}
                placeholder="curl -s https://wttr.in/Bariloche"
              />
            )}
            {kind === "exec_agent" && (
              <VarTextarea label={t("project.routines.prompt_exec")} rows={4} value={prompt} onChange={setPrompt}
                vars={varsFor("prompt")} placeholder={t("project.routines.prompt_exec_ph")} />
            )}
            {kind === "super_agent" && (
              <VarTextarea label={t("project.routines.prompt_super")} rows={4} value={prompt} onChange={setPrompt}
                vars={varsFor("prompt")} placeholder={t("project.routines.prompt_super_ph")} />
            )}

            {/* Telegram: channel selector + chat id + texto (con {{pre_output}}) */}
            {kind === "telegram" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("project.routines.tg_channel")}>
                    <UiSelect value={tgChannel} onChange={setTgChannel} options={channelOptions} />
                  </Field>
                  <Field label={t("project.routines.tg_chat_id")}><Input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder={t("agents_ui.tg_chat_id_ph")} /></Field>
                </div>
                <VarTextarea label={t("project.routines.tg_text")} hint={t("project.routines.tg_text_hint")}
                  rows={6} value={tgText} onChange={setTgText} vars={varsFor("prompt")} placeholder={t("agents_ui.tg_text_ph")} />
              </>
            )}

            {/* Shell: un comando, sin variables */}
            {kind === "shell" && (
              <Field label={t("project.routines.shell_field")} hint={t("project.routines.shell_hint")}>
                <Textarea rows={11} className="font-mono text-xs" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="cd /repo && git pull && npm test" />
              </Field>
            )}

            {/* Heartbeat: solo loguea (no se ofrece para rutinas nuevas) */}
            {kind === "heartbeat" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("project.routines.hb_channel")}><Input value={hbChannel} onChange={(e) => setHbChannel(e.target.value)} placeholder="heartbeat" /></Field>
                <Field label={t("project.routines.hb_message")}><Input value={hbMessage} onChange={(e) => setHbMessage(e.target.value)} placeholder={t("agents_ui.hb_message_ph")} /></Field>
              </div>
            )}

            {usesPrePost && (
              <VarTextarea
                label={t("project.routines.post_field")} hint={t("project.routines.post_hint")}
                rows={2} mono value={post} onChange={setPost} vars={varsFor("post")}
                placeholder={'apx telegram send "$APX_LLM_OUTPUT"'}
              />
            )}
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
