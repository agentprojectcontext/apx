import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import useSWR from "swr";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, Bot, Brain, Crown, Gauge,
  Heart, MessagesSquare, Save, Send, Settings, Sparkles, Trash2, Wrench, Activity,
} from "lucide-react";
import { Agents, Conversations, Messages, Routines, Tasks, Tools } from "../../lib/api";
import type { AgentDetail, AgentEntry, MessageEntry, RoutineEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { AgentBrainGraph, type BrainNode } from "./AgentBrainGraph";

type TabKey = "overview" | "memories" | "records" | "sleep" | "brain" | "config";
const TABS: { key: TabKey; label: string; icon: typeof Bot }[] = [
  { key: "overview", label: "Explorer", icon: Gauge },
  { key: "memories", label: "Memorias", icon: Brain },
  { key: "records",  label: "Records",  icon: Activity },
  { key: "sleep",    label: "Sleep",    icon: Heart },
  { key: "brain",    label: "Brain",    icon: Sparkles },
  { key: "config",   label: "Config",   icon: Settings },
];

const TYPE_OPTIONS = [
  { value: "", label: "— sin tipo —" },
  { value: "orchestrator", label: "Orchestrator", description: "Coordina al equipo y delega." },
  { value: "specialist",   label: "Specialist",   description: "Experto en un dominio; ejecuta tareas." },
  { value: "assistant",    label: "Assistant",    description: "Ayudante conversacional." },
  { value: "worker",       label: "Worker",       description: "Corre tareas autónomas." },
  { value: "monitor",      label: "Monitor",      description: "Observa estado y reporta." },
];
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const routinesForAgent = (rs: RoutineEntry[], slug: string) =>
  rs.filter((r) => (r.spec as any)?.agent === slug || (slug === "super-agent" && r.kind === "super_agent"));

function memoryFacts(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*#>\s]+/, "").trim())
    .filter((l) => l.length > 2 && !l.startsWith("```"))
    .slice(0, 12);
}

export function AgentDetailScreen({ pid }: { pid: string }) {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("overview");

  const detail = useSWR(`/projects/${pid}/agents/${slug}`, () => Agents.get(pid, slug));
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const routines = useSWR(`/projects/${pid}/routines`, () => Routines.list(pid));
  const records = useSWR(`/projects/${pid}/messages?agent=${slug}`, () => Messages.project(pid, { agent: slug, limit: 200 }));
  const threads = useSWR(`/projects/${pid}/agents/${slug}/conversations`, () => Conversations.list(pid, slug));
  const tasks = useSWR(`/projects/${pid}/tasks?all`, () => Tasks.list(pid, "all"));

  const a = detail.data;
  const myRoutines = routinesForAgent(routines.data || [], slug);
  const myTasks = (tasks.data || []).filter((t) => t.agent === slug);
  const children = (agents.data || []).filter((x) => x.parent === slug);

  if (detail.isLoading) return <Loading />;
  if (!a) return <div className="text-sm text-muted-fg">Agente no encontrado.</div>;

  const Icon = a.is_master ? Crown : Bot;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(`/p/${pid}/agents`)} className="mt-1 text-muted-fg hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <div className={cn("flex size-11 items-center justify-center rounded-xl bg-gradient-to-br", a.is_master ? "from-violet-600 to-indigo-600" : "from-slate-600 to-gray-600")}>
            <Icon className="size-5 text-white" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{a.slug}</h1>
              {a.is_master && <Badge tone="success"><Crown size={10} /> Orquestador</Badge>}
              {a.role && <Badge>{a.role}</Badge>}
              {a.model && <Badge tone="info">{a.model}</Badge>}
              {a.parent && (
                <button onClick={() => navigate(`/p/${pid}/agents/${a.parent}`)} className="text-[11px] text-violet-400 hover:underline">
                  ↳ reporta a {a.parent}
                </button>
              )}
            </div>
            {a.description && <p className="mt-0.5 max-w-2xl text-xs text-muted-fg">{a.description}</p>}
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={() => navigate(`/p/${pid}/chat?agent=${slug}`)}>
          <Send size={13} /> Chat con {a.slug}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(({ key, label, icon: TI }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors -mb-px",
              tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-fg hover:text-foreground",
            )}
          >
            <TI size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Threads" value={threads.data?.length ?? 0} icon={MessagesSquare} />
            <Stat label="Records" value={records.data?.length ?? 0} icon={Activity} />
            <Stat label="Tasks" value={myTasks.length} icon={Gauge} />
            <Stat label="Heartbeats" value={myRoutines.length} icon={Heart} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Skills & tools" description="">
              <div className="flex flex-wrap gap-1">
                {a.skills?.map((s) => <Badge key={s} tone="info"><Sparkles size={10} /> {s}</Badge>)}
                {a.tools?.map((t) => <Badge key={t}><Wrench size={10} /> {t}</Badge>)}
                {!a.skills?.length && !a.tools?.length && <span className="text-xs text-muted-fg">—</span>}
              </div>
            </Section>
            <Section title="Threads recientes" description="">
              <ul className="space-y-1 text-xs">
                {(threads.data || []).slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1">
                    <span className="truncate">{t.title || t.filename}</span>
                    <span className="shrink-0 text-muted-fg">{t.messages ?? 0} msgs</span>
                  </li>
                ))}
                {!threads.data?.length && <li className="text-muted-fg">Sin threads.</li>}
              </ul>
            </Section>
          </div>
          {children.length > 0 && (
            <Section title="Subagentes" description="Agentes que reportan a este orquestador.">
              <div className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <button key={c.slug} onClick={() => navigate(`/p/${pid}/agents/${c.slug}`)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm hover:border-muted-fg/50">
                    <Bot size={14} className="text-muted-fg" /> {c.slug}
                  </button>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === "memories" && <MemoryEditor pid={pid} slug={slug} initial={a.memory || ""} onSaved={() => detail.mutate()} />}

      {tab === "records" && <RecordsList records={records.data || []} loading={records.isLoading} />}

      {tab === "sleep" && <SleepView routines={myRoutines} />}

      {tab === "brain" && (
        <BrainTab
          slug={slug}
          memory={a.memory || ""}
          threads={(threads.data || []).map((t) => ({ id: t.id, label: t.title || t.filename }))}
          tasks={myTasks.map((t) => ({ id: t.id, label: t.title, detail: t.body || undefined }))}
          routines={myRoutines}
          parent={a.parent || null}
          children={children.map((c) => c.slug)}
        />
      )}

      {tab === "config" && (
        <AgentConfigForm
          pid={pid}
          agent={a}
          agents={agents.data || []}
          onSaved={() => { detail.mutate(); agents.mutate(); }}
          onDeleted={() => { agents.mutate(); navigate(`/p/${pid}/agents`); }}
        />
      )}
    </div>
  );
}

function AgentConfigForm({
  pid, agent, agents, onSaved, onDeleted,
}: {
  pid: string;
  agent: AgentDetail;
  agents: AgentEntry[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [type, setType] = useState(agent.type || "");
  const [area, setArea] = useState(agent.area || "");
  const [role, setRole] = useState(agent.role || "");
  const [model, setModel] = useState(agent.model || "");
  const [parent, setParent] = useState(agent.parent || "");
  const [isMaster, setIsMaster] = useState(!!agent.is_master);
  const [skills, setSkills] = useState((agent.skills || []).join(", "));
  const [tools, setTools] = useState((agent.tools || []).join(", "));
  const [description, setDescription] = useState(agent.description || "");
  const [system, setSystem] = useState(agent.system || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await Agents.update(pid, agent.slug, {
        type: type || null,
        area: area || null,
        role: role || null,
        model: model || null,
        parent: parent || null,
        is_master: isMaster || type === "orchestrator",
        skills: csv(skills),
        tools: csv(tools),
        description: description || null,
        system,
      });
      toast.success("Agente actualizado.");
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!confirm(`Borrar el agente "${agent.slug}"? Se elimina .apc/agents/${agent.slug}.md y su carpeta.`)) return;
    try { await Agents.remove(pid, agent.slug); toast.success("Agente borrado."); onDeleted(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Section title="Configuración del agente" description={`.apc/agents/${agent.slug}.md — definición (frontmatter + system prompt).`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipología (type)"><UiSelect value={type} onChange={setType} options={TYPE_OPTIONS} /></Field>
          <Field label="Área" hint="ej. operaciones, marketing"><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="operaciones" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Operations Lead" /></Field>
          <Field label="Reporta a (parent)">
            <UiSelect
              value={parent}
              onChange={setParent}
              placeholder="— ninguno —"
              options={[{ value: "", label: "— ninguno —" }, ...agents.filter((x) => x.slug !== agent.slug).map((x) => ({ value: x.slug, label: x.slug }))]}
            />
          </Field>
        </div>
        <Field label="Modelo base" hint="Vacío = usa el modelo del Router (default). Setealo solo para forzar un modelo a este agente.">
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="(vacío = router default)" />
        </Field>
        <Field label="Skills (coma)"><Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="skill-a, skill-b" /></Field>
        <ToolsPicker value={tools} onChange={setTools} />
        <Field label="Bio / descripción"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="System prompt" hint="Define personalidad y comportamiento (cuerpo del AGENT.md).">
          <Textarea rows={10} className="font-mono text-xs" value={system} onChange={(e) => setSystem(e.target.value)} placeholder="You are…" />
        </Field>
        <Switch checked={isMaster} onChange={setIsMaster} label="Orquestador (master)" />

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="destructive" onClick={del}><Trash2 size={13} /> Borrar agente</Button>
          <Button variant="primary" loading={busy} onClick={save}><Save size={13} /> Guardar cambios</Button>
        </div>
      </div>
    </Section>
  );
}

function Stat({ label, value, icon: I }: { label: string; value: number; icon: typeof Bot }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-fg"><I size={13} /> {label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function MemoryEditor({ pid, slug, initial, onSaved }: { pid: string; slug: string; initial: string; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(initial); }, [initial]);
  const dirty = value !== initial;
  const save = async () => {
    setBusy(true);
    try { await Agents.memory.put(pid, slug, value); toast.success("Memoria guardada."); onSaved(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Memoria del agente" description={`.apc/agents/${slug}/memory.md — hechos durables que el agente recuerda.`}>
      <Textarea rows={16} className="font-mono text-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder="(memoria vacía)" />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-fg">{value.length} chars · Markdown</span>
        <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={save}><Save size={12} /> Guardar</Button>
      </div>
    </Section>
  );
}

function RecordsList({ records, loading }: { records: MessageEntry[]; loading: boolean }) {
  const sorted = useMemo(() => [...records].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")), [records]);
  return (
    <Section title="Records" description="Log de actividad del agente (mensajes/acciones). Lo más nuevo primero.">
      {loading && <Loading />}
      {!loading && sorted.length === 0 && <p className="text-xs text-muted-fg">Sin actividad registrada.</p>}
      <ul className="space-y-1 text-sm">
        {sorted.map((m, i) => (
          <li key={`${m.ts}-${i}`} className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="mt-0.5 shrink-0">
              {m.direction === "in" ? <ArrowDownLeft size={13} className="text-blue-400" /> : <ArrowUpRight size={13} className="text-emerald-400" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-fg">
                <span className="font-mono">{new Date(m.ts).toLocaleString()}</span>
                <Badge tone="info">{m.channel}</Badge>
                {m.type && <Badge>{m.type}</Badge>}
              </div>
              {m.body && <p className="mt-1 whitespace-pre-wrap break-words text-xs">{m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SleepView({ routines }: { routines: RoutineEntry[] }) {
  if (routines.length === 0) {
    return (
      <Section title="Sleep / Heartbeat" description="Estado de ejecución del agente, derivado de sus rutinas.">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="font-medium text-amber-400">Deep sleep · sin heartbeat</div>
          <p className="mt-1 text-xs text-muted-fg">Este agente no tiene ninguna rutina que lo dispare. No se ejecuta de forma autónoma; solo responde cuando lo invocás (chat / tarea).</p>
        </div>
      </Section>
    );
  }
  return (
    <Section title="Sleep / Heartbeat" description="Estado de ejecución del agente, derivado de sus rutinas.">
      <div className="space-y-3">
        {routines.map((r) => {
          const running = r.enabled;
          const err = r.last_status === "error";
          return (
            <div key={r.name} className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", err ? "bg-destructive" : running ? "bg-emerald-400" : "bg-muted-fg/40")} />
                <span className="text-sm font-medium">{r.name}</span>
                <Badge tone={running ? "success" : "muted"}>{running ? "running" : "paused"}</Badge>
                {err && <Badge tone="danger">last: error</Badge>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Field2 label="Tick" value={r.schedule} />
                <Field2 label="Next tick" value={r.next_run_at ? new Date(r.next_run_at).toLocaleString() : "—"} />
                <Field2 label="Last tick" value={r.last_run_at ? new Date(r.last_run_at).toLocaleString() : "—"} />
                <Field2 label="Last run" value={r.last_status || "—"} />
              </div>
              {r.last_error && <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{r.last_error}</p>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Field2({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-fg">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px]">{value}</div>
    </div>
  );
}

function ToolsPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const cat = useSWR("/tools", () => Tools.list());
  const selected = csv(value);
  const catalog = cat.data || [];
  const toggle = (name: string) => {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name); else set.add(name);
    onChange([...set].join(", "));
  };
  const custom = selected.filter((s) => !catalog.some((t) => t.name === s));
  return (
    <Field label="Tools" hint="Qué tools puede usar el agente. Tocá para activar/desactivar; o editá la lista abajo.">
      <div className="flex flex-wrap gap-1.5">
        {catalog.map((t) => {
          const on = selected.includes(t.name);
          return (
            <button key={t.name} type="button" title={t.description || t.name} onClick={() => toggle(t.name)}
              className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" : "border-border text-muted-fg hover:text-foreground")}>
              {t.name}
            </button>
          );
        })}
        {custom.map((s) => (
          <button key={s} type="button" onClick={() => toggle(s)}
            className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] text-sky-400">
            {s} ✕
          </button>
        ))}
      </div>
      <Input className="mt-2" value={value} onChange={(e) => onChange(e.target.value)} placeholder="lista (coma): echo, http_fetch" />
    </Field>
  );
}

function BrainTab({
  slug, memory, threads, tasks, routines, parent, children,
}: {
  slug: string;
  memory: string;
  threads: { id: string; label: string }[];
  tasks: { id: string; label: string; detail?: string }[];
  routines: RoutineEntry[];
  parent: string | null;
  children: string[];
}) {
  const nodes: BrainNode[] = useMemo(() => {
    const out: BrainNode[] = [];
    memoryFacts(memory).forEach((f, i) => out.push({ id: `m${i}`, label: f, kind: "memory", relation: "knows", detail: f }));
    threads.slice(0, 8).forEach((t) => out.push({ id: `th-${t.id}`, label: t.label, kind: "thread", relation: "in_thread" }));
    tasks.slice(0, 8).forEach((t) => out.push({ id: `ts-${t.id}`, label: t.label, kind: "task", relation: "handles_task", detail: t.detail }));
    routines.forEach((r) => out.push({ id: `rt-${r.name}`, label: r.name, kind: "routine", relation: "ticks", detail: `schedule: ${r.schedule}` }));
    if (parent) out.push({ id: `p-${parent}`, label: parent, kind: "agentlink", relation: "reports_to" });
    children.forEach((c) => out.push({ id: `c-${c}`, label: c, kind: "agentlink", relation: "orchestrates" }));
    return out;
  }, [memory, threads, tasks, routines, parent, children]);

  return (
    <Section title="Brain" description="Grafo de relaciones reales del agente: memoria, threads, tasks, heartbeats y jerarquía. (primera versión — lo refinamos)">
      {nodes.length === 0
        ? <p className="text-xs text-muted-fg">Aún no hay relaciones para graficar (sin memoria, threads, tasks ni rutinas).</p>
        : <AgentBrainGraph center={slug} nodes={nodes} />}
    </Section>
  );
}
