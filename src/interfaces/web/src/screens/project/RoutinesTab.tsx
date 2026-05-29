import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowRight, Bot, Crown, Heart, Play, Plus, Send, Terminal, Trash2, Zap } from "lucide-react";
import { Routines, Agents, type RoutineEntry } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";

function splitLines(v: string): string[] {
  return v.split("\n").map((s) => s.trim()).filter(Boolean);
}

type Kind = RoutineEntry["kind"];

// Friendly action types (maps to routines.js kinds).
const KIND_META: Record<Kind, { label: string; desc: string; icon: typeof Bot }> = {
  exec_agent:  { label: "Agente del proyecto", desc: "Ejecuta un agente del proyecto con un prompt. Elegís cuál.", icon: Bot },
  super_agent: { label: "Super-agente",        desc: "Llama al super-agente de APX con un prompt.", icon: Crown },
  telegram:    { label: "Telegram",            desc: "Manda un mensaje fijo a un canal de Telegram. No usa modelo ni agente.", icon: Send },
  shell:       { label: "Shell",               desc: "Corre un comando de shell. Sin prompt ni pre/post — el comando es la acción.", icon: Terminal },
  heartbeat:   { label: "Latido (heartbeat)",  desc: "No hace nada salvo escribir una línea en los logs cada vez que corre. Sirve para confirmar que el scheduler está vivo. Si no sabés si lo necesitás, no lo uses.", icon: Heart },
};
const KIND_OPTIONS = (Object.keys(KIND_META) as Kind[]).map((k) => ({ value: k, label: KIND_META[k].label, description: KIND_META[k].desc, icon: KIND_META[k].icon }));

// "every:10m" → "cada 10 minutos", cron/once → legible.
function scheduleHuman(s?: string): string {
  if (!s) return "—";
  if (s.startsWith("every:")) {
    const v = s.slice(6);
    const m = v.match(/^(\d+)(s|m|h|d)$/);
    if (m) {
      const n = m[1];
      const unit = { s: "segundos", m: "minutos", h: "horas", d: "días" }[m[2]] || m[2];
      return `cada ${n} ${unit}`;
    }
    return `cada ${v}`;
  }
  if (s.startsWith("once:")) return `una vez · ${new Date(s.slice(5)).toLocaleString()}`;
  if (s.startsWith("cron ")) return `cron · ${s.slice(5)}`;
  return s;
}

const SCHED_PRESETS = [
  { label: "cada 10 min", value: "every:10m" },
  { label: "cada hora", value: "every:1h" },
  { label: "diario 9am", value: "cron 0 9 * * *" },
  { label: "días hábiles 9am", value: "cron 0 9 * * 1-5" },
];

// Template/env vars the routine runner exposes (src/host/daemon/routines.js).
const VARS = [
  { v: "{{pre_output}}", where: "prompt", desc: "Salida de los pre-commands, inyectada en el prompt." },
  { v: "$APX_LLM_OUTPUT", where: "post", desc: "Respuesta del agente / super-agente." },
  { v: "$APX_STATUS", where: "post", desc: "ok | error." },
  { v: "$APX_SKIPPED", where: "post", desc: "1 si la acción se salteó." },
  { v: "$APX_PRE_OUTPUT", where: "post", desc: "Salida de los pre-commands." },
  { v: "$APX_PRE_OUTPUT_FILE", where: "post", desc: "Archivo con la salida de pre (para outputs grandes)." },
  { v: "$APX_PRE_EXIT", where: "post", desc: "Exit code de los pre-commands." },
  { v: "$APX_ROUTINE", where: "pre/post", desc: "Nombre de la rutina." },
];

function actionSummary(kind: Kind, spec: Record<string, unknown>): string {
  switch (kind) {
    case "exec_agent": return spec.agent ? `Ejecuta el agente "${spec.agent}"` : "Ejecuta un agente (falta elegir)";
    case "super_agent": return "Llama al super-agente";
    case "telegram": return `Envía Telegram a "${spec.channel || "default"}"`;
    case "shell": return spec.command ? `Corre: ${String(spec.command).slice(0, 40)}` : "Corre un comando shell";
    case "heartbeat": return "Deja un latido en logs";
  }
}

export function RoutinesTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/routines`, () => Routines.list(pid));
  const [editing, setEditing] = useState<Partial<RoutineEntry> | null>(null);

  const toggle = async (r: RoutineEntry) => {
    try { await (r.enabled ? Routines.disable : Routines.enable)(pid, r.name); list.mutate(); }
    catch (e: any) { toast.error(e?.message || "toggle falló"); }
  };
  const runNow = async (r: RoutineEntry) => {
    try { await Routines.run(pid, r.name); toast.success(`${r.name} disparada.`); }
    catch (e: any) { toast.error(e?.message || "run falló"); }
  };
  const remove = async (r: RoutineEntry) => {
    if (!confirm(`Borrar rutina ${r.name}?`)) return;
    try { await Routines.remove(pid, r.name); toast.success("borrada."); list.mutate(); }
    catch (e: any) { toast.error(e?.message || "delete falló"); }
  };

  return (
    <Section
      title="Rutinas"
      description="Tareas programadas (cron · cada N · una vez). Cada rutina dispara un agente, el super-agente, Telegram o un shell. Click en una fila para editar."
      action={<Button size="sm" variant="primary" onClick={() => setEditing({ kind: "super_agent", schedule: "every:10m", enabled: true })}>
        <Plus size={14} /> Nueva
      </Button>}
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>Sin rutinas. Creá una arriba.</Empty>}
      <ul className="space-y-2 text-sm">
        {(list.data || []).map((row) => {
          const meta = KIND_META[row.kind];
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
                  {!row.enabled && <Badge tone="muted">pausada</Badge>}
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={row.enabled} onChange={() => toggle(row)} />
                  <Button size="sm" variant="secondary" onClick={() => runNow(row)}><Play size={13} /> Run</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(row)}><Trash2 size={13} /></Button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-fg">
                <span>⏱ {scheduleHuman(row.schedule)}</span>
                <span>{actionSummary(row.kind, row.spec || {})}</span>
                {row.next_run_at && <span>próxima: {new Date(row.next_run_at).toLocaleString()}</span>}
                <span className={cn(row.last_status === "ok" && "text-emerald-500", err && "text-destructive")}>
                  última: {row.last_status || "—"}
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
    if (!name) { toast.error("name requerido"); return; }
    setBusy(true);
    try {
      const usePP = kind === "exec_agent" || kind === "super_agent";
      await Routines.upsert(pid, {
        name, kind, schedule, enabled,
        spec: buildSpec(),
        pre_commands: usePP ? splitLines(pre) : [],
        post_commands: usePP ? splitLines(post) : [],
      });
      toast.success("Rutina guardada.");
      onSaved();
    } catch (e: any) { toast.error(e?.message || "save falló"); }
    finally { setBusy(false); }
  };

  // Only the LLM kinds wrap the action with pre/post shell commands.
  const usesPrePost = kind === "exec_agent" || kind === "super_agent";
  // Timeline steps (pre → action → post).
  const preSteps = usesPrePost ? splitLines(pre) : [];
  const postSteps = usesPrePost ? splitLines(post) : [];
  const actionLabel = (() => {
    switch (kind) {
      case "exec_agent": return agent ? `Agente "${agent}" responde el prompt` : "Agente (elegí cuál) responde el prompt";
      case "super_agent": return "El super-agente responde el prompt";
      case "telegram": return `Manda Telegram al canal "${tgChannel}"`;
      case "shell": return command ? `Corre: ${command.slice(0, 48)}` : "Corre el comando shell";
      case "heartbeat": return "Deja un latido en logs";
    }
  })();
  const usesPrompt = usesPrePost;

  const ActionIcon = KIND_META[kind].icon;
  const steps = [
    ...preSteps.map((c, i) => ({ id: `pre-${i}`, icon: Terminal, label: "Pre", detail: c, action: false })),
    { id: "action", icon: ActionIcon, label: actionLabel, detail: usesPrompt && prompt ? prompt.slice(0, 90) : undefined, action: true },
    ...postSteps.map((c, i) => ({ id: `post-${i}`, icon: Terminal, label: "Post", detail: c, action: false })),
  ];

  return (
    <Dialog
      open={!!draft}
      onClose={onClose}
      title={draft?.name ? `Editar ${draft.name}` : "Nueva rutina"}
      description="Se guarda en .apc/routines.json. La rutina corre mientras el daemon está activo."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* status */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
          <Switch checked={enabled} onChange={setEnabled} label="Habilitada" />
          <span className="text-[11px] text-muted-fg">{enabled ? "Activa · corre según el intervalo" : "Pausada · solo con el botón Run"}</span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* LEFT — qué y cuándo */}
          <div className="space-y-3">
            <Field label="Nombre (name)" hint={draft?.name ? "No se puede cambiar al editar." : undefined}>
              <Input value={name} disabled={!!draft?.name} onChange={(e) => setName(e.target.value)} placeholder="resumen-diario" />
            </Field>
            <Field label="Acción (kind)">
              <UiSelect value={kind} onChange={(v) => setKind(v as Kind)} options={KIND_OPTIONS} />
            </Field>
            <p className="-mt-1 text-[11px] text-muted-fg">{KIND_META[kind].desc}</p>
            {kind === "exec_agent" && (
              <Field label="Agente (spec.agent)" hint="Quién ejecuta la rutina.">
                <UiSelect value={agent} onChange={setAgent} placeholder={agentsList.isLoading ? "cargando…" : "— elegí un agente —"}
                  options={(agentsList.data || []).map((a) => ({ value: a.slug, label: a.slug, description: [a.role, a.model].filter(Boolean).join(" · ") || undefined }))} />
              </Field>
            )}
            <Field label="Intervalo (schedule)" hint="Elegí un preset o escribilo a mano. Manual = solo corre con el botón Run.">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {SCHED_PRESETS.map((s) => (
                    <button key={s.value} type="button" onClick={() => setSchedule(s.value)}
                      className={cn("rounded-md border px-2 py-0.5 text-[11px]", schedule === s.value ? "border-emerald-500/50 text-emerald-400" : "border-border text-muted-fg hover:text-foreground")}>
                      {s.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setSchedule("manual")}
                    className={cn("rounded-md border px-2 py-0.5 text-[11px]", schedule === "manual" ? "border-emerald-500/50 text-emerald-400" : "border-border text-muted-fg hover:text-foreground")}>
                    Manual
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
              <Field label="Pre-commands (pre_commands)" hint="Shell ANTES del prompt. Uno por línea.">
                <Textarea rows={2} className="font-mono text-xs" value={pre} onChange={(e) => setPre(e.target.value)} placeholder="curl -s https://wttr.in/Bariloche" />
              </Field>
            )}
            {kind === "exec_agent" && (
              <Field label="Prompt (spec.prompt)"><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="qué pendiente hay para hoy?" /></Field>
            )}
            {kind === "super_agent" && (
              <Field label="Prompt (spec.prompt)"><Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="resumí el estado del proyecto" /></Field>
            )}

            {/* Telegram: solo manda un mensaje (sin LLM) */}
            {kind === "telegram" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Canal (spec.channel)"><Input value={tgChannel} onChange={(e) => setTgChannel(e.target.value)} placeholder="default" /></Field>
                  <Field label="Chat ID (spec.chat_id)"><Input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} placeholder="(usa el del canal)" /></Field>
                </div>
                <Field label="Texto (spec.text)" hint="Mensaje fijo a enviar. No usa modelo.">
                  <Textarea rows={8} value={tgText} onChange={(e) => setTgText(e.target.value)} placeholder="mensaje a enviar" />
                </Field>
              </>
            )}

            {/* Shell: un comando, ocupando todo */}
            {kind === "shell" && (
              <Field label="Comando (spec.command)" hint="Corre tal cual en el shell. Sin prompt ni pre/post.">
                <Textarea rows={11} className="font-mono text-xs" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="cd /repo && git pull && npm test" />
              </Field>
            )}

            {/* Heartbeat: solo loguea */}
            {kind === "heartbeat" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal (spec.channel)"><Input value={hbChannel} onChange={(e) => setHbChannel(e.target.value)} placeholder="heartbeat" /></Field>
                <Field label="Mensaje (spec.message)"><Input value={hbMessage} onChange={(e) => setHbMessage(e.target.value)} placeholder="sigo vivo" /></Field>
              </div>
            )}

            {usesPrePost && (
              <Field label="Post-commands (post_commands)" hint="Shell DESPUÉS del prompt. Uno por línea.">
                <Textarea rows={2} className="font-mono text-xs" value={post} onChange={(e) => setPost(e.target.value)} placeholder={'apx telegram send "$APX_LLM_OUTPUT"'} />
              </Field>
            )}
          </div>
        </div>

        {/* Variables disponibles */}
        <div className="rounded-lg border border-border bg-muted/10 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">Variables disponibles</div>
          <div className="flex flex-wrap gap-1.5">
            {VARS.map((v) => (
              <span key={v.v} title={v.desc} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">
                {v.v}<span className="not-italic text-muted-fg">· {v.where}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Qué va a pasar — full width */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-semibold text-muted-fg">Qué va a pasar <span className="font-normal text-muted-fg">· ⏱ {scheduleHuman(schedule)}</span></div>
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
