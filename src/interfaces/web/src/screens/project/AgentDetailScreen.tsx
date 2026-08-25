import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import useSWR from "swr";
import {
  ArrowDownLeft, ArrowLeft, ArrowUpRight, Bot, Brain, Copy, Crown, FileText, Gauge,
  Heart, MessagesSquare, Pencil, Save, Send, Settings, Sparkles, Trash2, Wrench, Activity,
} from "lucide-react";
import { Agents, Conversations, Messages, Routines, Tasks, Tools } from "../../lib/api";
import type { AgentDetail, AgentEntry, FileContent, MessageEntry, RoutineEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { AutonomyPicker, AreaRoleFields, AgentIconPicker } from "../../components/agents/AgentFormFields";
import { AgentSkillsPicker } from "../../components/agents/AgentSkillsPicker";
import { AgentModelSelect } from "../../components/agents/AgentModelSelect";
import { INHERIT_MODEL, isInheritedModel } from "../../components/agents/modelCatalog";
import { useProject } from "../../hooks/useProjects";
import { BlobAvatar } from "../../components/agents/BlobAvatar";
import { isBlobKey } from "../../components/agents/blobPresets";
import { FileViewer } from "../../components/files/FileViewer";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneOutline, toneText } from "../../lib/tone";
import type { AgentAutonomy } from "../../types/daemon";
import { BrainGraph, type BrainNode, type BrainEdge, agentPreview, routinePreview, clipPreview } from "./AgentBrainGraph";

type TabKey = "overview" | "memories" | "records" | "sleep" | "brain" | "prompt" | "config";
function buildTabs(): { key: TabKey; label: string; icon: typeof Bot }[] {
  return [
    { key: "overview", label: t("agents_ui.tab_explorer"),        icon: Gauge },
    { key: "memories", label: t("project.nav.memories"),          icon: Brain },
    { key: "records",  label: t("project.agent_detail.records_title"), icon: Activity },
    { key: "sleep",    label: t("project.agent_detail.sleep_title"),   icon: Heart },
    { key: "brain",    label: t("project.agent_detail.brain_title"),   icon: Sparkles },
    { key: "prompt",   label: t("project.agent_detail.tab_prompt"),    icon: FileText },
    { key: "config",   label: t("project.agent_detail.tab_config"),    icon: Settings },
  ];
}

export function typeOptions() {
  return [
    { value: "", label: t("agents_ui.type_none") },
    { value: "orchestrator", label: t("agents_ui.type_orchestrator"), description: t("agents_ui.type_orchestrator_desc") },
    { value: "specialist",   label: t("agents_ui.type_specialist"),   description: t("agents_ui.type_specialist_desc") },
    { value: "assistant",    label: t("agents_ui.type_assistant"),    description: t("agents_ui.type_assistant_desc") },
    { value: "worker",       label: t("agents_ui.type_worker"),       description: t("agents_ui.type_worker_desc") },
    { value: "monitor",      label: t("agents_ui.type_monitor"),      description: t("agents_ui.type_monitor_desc") },
  ];
}
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Height cap for the skills scroller, chosen to sit level with the tools card
// beside it rather than stretching the row to the full skill catalog.
const SKILLS_SCROLLER_MAX = 260;

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
  const [searchParams] = useSearchParams();
  const TABS = buildTabs();
  // Tab lives in the URL (?tab=…) so views are linkable and survive reloads.
  const raw = searchParams.get("tab");
  const tab: TabKey = TABS.some((x) => x.key === raw) ? (raw as TabKey) : "overview";

  const { project } = useProject(pid);
  const detail = useSWR(`/api/projects/${pid}/agents/${slug}`, () => Agents.get(pid, slug));
  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));
  const routines = useSWR(`/api/projects/${pid}/routines`, () => Routines.list(pid));
  const records = useSWR(`/api/projects/${pid}/messages?agent=${slug}`, () => Messages.project(pid, { agent: slug, limit: 200 }));
  const threads = useSWR(`/api/projects/${pid}/agents/${slug}/conversations`, () => Conversations.list(pid, slug));
  const tasks = useSWR(`/api/projects/${pid}/tasks?all`, () => Tasks.list(pid, "all"));

  const a = detail.data;
  const myRoutines = routinesForAgent(routines.data || [], slug);
  const myTasks = (tasks.data || []).filter((t) => t.agent === slug);
  const children = (agents.data || []).filter((x) => x.parent === slug);

  if (detail.isLoading) return <Loading />;
  if (!a) return <div className="text-sm text-muted-fg">{t("project.agent_detail.not_found")}</div>;

  const Icon = a.is_master ? Crown : Bot;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(`/p/${pid}/agents`)} className="mt-1 text-muted-fg hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          {isBlobKey(a.icon) ? (
            <BlobAvatar preset={a.icon} size={44} seed={a.slug} className="shrink-0" />
          ) : (
            <div className={cn("flex size-11 items-center justify-center rounded-xl bg-gradient-to-br", a.is_master ? "from-violet-600 to-indigo-600" : "from-slate-600 to-gray-600")}>
              {a.emoji ? <span className="text-xl leading-none">{a.emoji}</span> : <Icon className="size-5 text-white" />}
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <AgentNameHeading
                pid={pid}
                slug={a.slug}
                name={a.name || ""}
                onSaved={() => { void detail.mutate(); void agents.mutate(); }}
              />
              {a.is_master && <Badge tone="success"><Crown size={10} /> {t("project.agents.orchestrator")}</Badge>}
              {a.role && <Badge>{a.role}</Badge>}
              {a.model && <Badge tone="info">{a.model}</Badge>}
              {a.parent && (
                <button onClick={() => navigate(`/p/${pid}/agents/${a.parent}`)} className={`text-[11px] hover:underline ${toneText.violet}`}>
                  {t("project.agent_detail.reports_to")} {a.parent}
                </button>
              )}
            </div>
            {a.description && <p className="mt-0.5 max-w-2xl text-xs text-muted-fg">{a.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CloneAgentButton
            pid={pid}
            slug={a.slug}
            onCloned={(newSlug) => {
              void agents.mutate();
              navigate(`/p/${pid}/agents/${newSlug}`);
            }}
          />
          <Button size="sm" variant="primary" onClick={() => navigate(`/p/${pid}/chat?agent=${slug}`)}>
            <Send size={13} /> {t("project.agent_detail.chat_btn", { slug: a.slug })}
          </Button>
        </div>
      </div>

      {/* Tabs — real links (?tab=…) so each view has a shareable href */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(({ key, label, icon: TI }) => (
          <Link
            key={key}
            to={`?tab=${key}`}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors -mb-px",
              tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-fg hover:text-foreground",
            )}
          >
            <TI size={14} /> {label}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("agents_ui.stat_threads")} value={threads.data?.length ?? 0} icon={MessagesSquare} />
            <Stat label={t("agents_ui.stat_records")} value={records.data?.length ?? 0} icon={Activity} />
            <Stat label={t("agents_ui.stat_tasks")} value={myTasks.length} icon={Gauge} />
            <Stat label={t("agents_ui.stat_heartbeats")} value={myRoutines.length} icon={Heart} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title={t("agent_detail_extra.skills_title")} description="">
              <div className="flex flex-wrap gap-1">
                {a.skills?.map((s) => <Badge key={s} tone="info"><Sparkles size={10} /> {s}</Badge>)}
                {a.tools?.map((t) => <Badge key={t}><Wrench size={10} /> {t}</Badge>)}
                {!a.skills?.length && !a.tools?.length && <span className="text-xs text-muted-fg">—</span>}
              </div>
            </Section>
            <Section title={t("project.agent_detail.threads_recent")} description="">
              <ul className="space-y-1 text-xs">
                {(threads.data || []).slice(0, 6).map((th) => (
                  <li key={th.id} className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1">
                    <span className="truncate">{th.title || th.filename}</span>
                    <span className="shrink-0 text-muted-fg">{th.messages ?? 0} {t("project.agent_detail.msgs_count")}</span>
                  </li>
                ))}
                {!threads.data?.length && <li className="text-muted-fg">{t("project.agent_detail.no_threads")}</li>}
              </ul>
            </Section>
          </div>
          {children.length > 0 && (
            <Section title={t("project.agent_detail.subagents")} description={t("project.agent_detail.subagents_desc")}>
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

      {tab === "memories" && <MemoryEditor pid={pid} slug={slug} onSaved={() => detail.mutate()} />}

      {tab === "records" && <RecordsList records={records.data || []} loading={records.isLoading} />}

      {tab === "sleep" && <SleepView routines={myRoutines} />}

      {tab === "brain" && (
        <BrainTab
          pid={pid}
          slug={slug}
          emoji={a.emoji || undefined}
          icon={a.icon || undefined}
          description={a.description || undefined}
          role={a.role || undefined}
          type={a.type || undefined}
          memory={a.memory || ""}
          threads={(threads.data || []).map((t) => ({ id: t.id, label: t.title || t.filename }))}
          tasks={myTasks.map((t) => ({ id: t.id, label: t.title, detail: t.body || undefined }))}
          routines={myRoutines}
          parent={a.parent
            ? ((agents.data || []).find((x) => x.slug === a.parent) ?? { slug: a.parent })
            : null}
          children={children}
        />
      )}

      {tab === "prompt" && (
        <SystemPromptEditor pid={pid} slug={slug} system={a.system || ""} onSaved={() => void detail.mutate()} />
      )}

      {tab === "config" && (
        <AgentConfigForm
          pid={pid}
          agent={a}
          agents={agents.data || []}
          projectPath={project?.path}
          onSaved={() => { detail.mutate(); agents.mutate(); }}
          onDeleted={() => { agents.mutate(); navigate(`/p/${pid}/agents`); }}
        />
      )}
    </div>
  );
}

// Heading that doubles as an inline rename. Click the pencil (or the name) to
// swap the h1 for an input; Enter/blur saves, Escape cancels. Only the display
// Name changes — the slug is the agent's identity (filename, parent links,
// delegation targets) and stays put.
function AgentNameHeading({
  pid, slug, name, onSaved,
}: { pid: string; slug: string; name: string; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);

  const start = () => { setDraft(name); setEditing(true); };

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === name) return;
    setBusy(true);
    try {
      await Agents.update(pid, slug, { name: next || null });
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void commit(); }
          if (e.key === "Escape") { setDraft(name); setEditing(false); }
        }}
        placeholder={slug}
        aria-label={t("agents_form.name")}
        className="rounded-md border border-border bg-card px-2 py-0.5 text-lg font-semibold outline-none focus:border-muted-fg"
      />
    );
  }

  return (
    <span className="group flex items-center gap-1.5">
      <h1 className="cursor-text text-lg font-semibold" onClick={start}>{name || slug}</h1>
      {name && <span className="font-mono text-[11px] text-muted-fg">{slug}</span>}
      <Tip content={t("common.edit")}>
        <button
          type="button"
          onClick={start}
          aria-label={t("common.edit")}
          className="text-muted-fg opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <Pencil size={13} />
        </button>
      </Tip>
    </span>
  );
}

// Duplicate this agent and jump to the copy. The heavy lifting (unique slug,
// " (n)" naming, prompt + memory copy) is server-side; here we only fire it,
// surface the toast, and let the parent navigate to the fresh agent.
function CloneAgentButton({
  pid, slug, onCloned,
}: { pid: string; slug: string; onCloned: (newSlug: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const clone = async () => {
    setBusy(true);
    try {
      const created = await Agents.clone(pid, slug);
      toast.success(t("project.agent_detail.clone_success", { slug: created.slug }));
      onCloned(created.slug);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Tip content={t("project.agent_detail.clone_hint")}>
      <Button size="sm" variant="secondary" loading={busy} onClick={clone}>
        <Copy size={13} /> {t("project.agent_detail.clone_btn")}
      </Button>
    </Tip>
  );
}

function AgentConfigForm({
  pid, agent, agents, projectPath, onSaved, onDeleted,
}: {
  pid: string;
  agent: AgentDetail;
  agents: AgentEntry[];
  projectPath?: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [icon, setIcon] = useState(agent.icon || "");
  const [name, setName] = useState(agent.name || "");
  const [type, setType] = useState(agent.type || "");
  const [area, setArea] = useState(agent.area || "");
  const [role, setRole] = useState(agent.role || "");
  const [autonomy, setAutonomy] = useState<AgentAutonomy | "">(agent.autonomy || "");
  const [model, setModel] = useState(agent.model || "");
  const [parent, setParent] = useState(agent.parent || "");
  const [isMaster, setIsMaster] = useState(!!agent.is_master);
  const [skills, setSkills] = useState<string[]>(agent.skills || []);
  // No declared skills ⇒ the agent inherits whatever the project enables.
  const [skillDefaults, setSkillDefaults] = useState((agent.skills || []).length === 0);
  const [tools, setTools] = useState((agent.tools || []).join(", "));
  const [description, setDescription] = useState(agent.description || "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The prompt body is edited in its own tab; here we only report its size.
  const promptLines = (agent.system || "").trim() ? (agent.system || "").trim().split("\n").length : 0;

  const save = async () => {
    setBusy(true);
    try {
      await Agents.update(pid, agent.slug, {
        name: name || null,
        icon: icon || null,
        type: type || null,
        area: area || null,
        role: role || null,
        autonomy: autonomy || null,
        model: isInheritedModel(model) ? INHERIT_MODEL : model,
        parent: parent || null,
        is_master: isMaster || type === "orchestrator",
        skills: skillDefaults ? [] : skills,
        tools: csv(tools),
        description: description || null,
      });
      toast.success(t("project.agent_detail.update_success"));
      onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const del = async () => {
    await Agents.remove(pid, agent.slug);
    toast.success(t("project.agent_detail.delete_success"));
    onDeleted();
  };

  return (
    <div className="space-y-4">
      {/* Actions sit at the top of the form so Save/Delete are reachable
          without scrolling past the whole config. */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <Button variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> {t("project.agent_detail.delete_btn")}</Button>
        <Button variant="primary" loading={busy} onClick={save}><Save size={13} /> {t("project.agent_detail.save_btn")}</Button>
      </div>

      {/* Identity | behavior side by side, capabilities last. The system
          prompt used to hold the right column, but it always dwarfed the rest
          of the form — it moved to its own tab (?tab=prompt) with the markdown
          editor, and behavior moved up into the space it left. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("project.agent_detail.config_identity")} description={`.apc/agents/${agent.slug}.md — ${t("agents_ui.config_def_desc")}`}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("agents_form.name")} hint={t("agents_form.name_hint")}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={agent.slug} />
              </Field>
              <Field label={t("project.agent_detail.type_label")}><UiSelect value={type} onChange={setType} options={typeOptions()} /></Field>
            </div>
            <Field label={t("agents_form.icon")}>
              <AgentIconPicker icon={icon} onIcon={setIcon} />
            </Field>
            <AreaRoleFields pid={pid} area={area} role={role} onArea={setArea} onRole={setRole} />
            <Field label={t("project.agent_detail.bio_label")}>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </Section>

        <div className="space-y-4">
          <Section title={t("project.agent_detail.config_behavior")} description={t("project.agent_detail.config_behavior_desc")}>
            <div className="space-y-3">
              <Field label={t("agents_form.autonomy")} hint={t("agents_form.autonomy_hint")}>
                <AutonomyPicker value={autonomy} onChange={setAutonomy} />
              </Field>
              <Field label={t("project.agent_detail.parent_label")}>
                <UiSelect
                  value={parent}
                  onChange={setParent}
                  placeholder={t("project.agent_detail.none_parent")}
                  options={[{ value: "", label: t("project.agent_detail.none_parent") }, ...agents.filter((x) => x.slug !== agent.slug).map((x) => ({ value: x.slug, label: x.slug }))]}
                />
              </Field>
              <Field label={t("project.agent_detail.model_label")} hint={t("project.agent_detail.model_hint")}>
                <AgentModelSelect value={model} onChange={setModel} />
              </Field>
              <Switch checked={isMaster} onChange={setIsMaster} label={t("project.agent_detail.master_label")} />
            </div>
          </Section>

          {/* The prompt left this form for its own tab — this keeps the trail
              visible from where people used to look for it. */}
          <Link
            to="?tab=prompt"
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-muted-fg/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileText size={14} className="shrink-0 text-muted-fg" />
              <span className="truncate text-sm font-medium">{t("project.agent_detail.system_label")}</span>
              <span className="shrink-0 text-xs text-muted-fg">
                {promptLines ? t("project.agent_detail.prompt_lines", { n: promptLines }) : t("project.agent_detail.prompt_empty")}
              </span>
            </span>
            <span className={`shrink-0 text-xs ${toneText.violet}`}>{t("common.open")} →</span>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("agents_form.skills_title")} description={t("agents_form.skills_desc")}>
          <AgentSkillsPicker
            value={skills}
            onChange={setSkills}
            projectPath={projectPath}
            useDefaults={skillDefaults}
            onUseDefaults={setSkillDefaults}
            matchHeight={SKILLS_SCROLLER_MAX}
          />
        </Section>

        <Section title={t("agents_ui.tools_label")} description={t("project.agent_detail.tools_hint")}>
          <ToolsPicker value={tools} onChange={setTools} />
        </Section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={del}
        title={t("project.agent_detail.delete_btn")}
        description={t("project.agent_detail.delete_confirm", { slug: agent.slug })}
        confirmLabel={t("project.agent_detail.delete_btn")}
      />
    </div>
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

// Durable memory for a single agent, using the same docs-style editor as the
// project /memories surface (markdown edit / split-preview / save) instead of a
// bare textarea.
function MemoryEditor({ pid, slug, onSaved }: { pid: string; slug: string; onSaved: () => void }) {
  const toast = useToast();
  const body = useSWR(`/api/memory/${pid}/agent:${slug}`, () => Agents.memory.get(pid, slug).then((r) => r.body));

  const file = useMemo<FileContent | null>(() => {
    if (body.data === undefined) return null;
    const content = body.data ?? "";
    return {
      path: `~/.apx/projects/<id>/agents/${slug}/memory.md`,
      name: "memory.md",
      kind: "markdown",
      size: content.length,
      modified: "",
      encoding: "utf8",
      content,
    };
  }, [body.data, slug]);

  const onSave = async (content: string) => {
    await Agents.memory.put(pid, slug, content);
    toast.success(t("project.agent_detail.memory_saved"));
    void body.mutate(content, { revalidate: false });
    onSaved();
  };

  return (
    <div className="flex h-[65vh] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <FileViewer file={file} loading={body.isLoading} onSave={onSave} />
    </div>
  );
}

// The system prompt is the body of .apc/agents/<slug>.md, and real prompts run
// hundreds of lines — far past what a form textarea beside the identity fields
// can show. It gets its own tab and the same markdown editor as memory/docs:
// rendered preview by default, split editing, ⌘S to save.
function SystemPromptEditor({
  pid, slug, system, onSaved,
}: { pid: string; slug: string; system: string; onSaved: () => void }) {
  const toast = useToast();

  const file = useMemo<FileContent>(() => ({
    path: `.apc/agents/${slug}.md`,
    name: `${slug}.md`,
    kind: "markdown",
    size: system.length,
    modified: "",
    encoding: "utf8",
    content: system,
  }), [slug, system]);

  const onSave = async (content: string) => {
    await Agents.update(pid, slug, { system: content });
    toast.success(t("project.agent_detail.update_success"));
    onSaved();
  };

  return (
    <Section
      title={t("project.agent_detail.system_label")}
      description={t("project.agent_detail.system_hint")}
      fullHeight
      className="h-[70vh] min-h-[460px]"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <FileViewer file={file} onSave={onSave} />
      </div>
    </Section>
  );
}

function RecordsList({ records, loading }: { records: MessageEntry[]; loading: boolean }) {
  const sorted = useMemo(() => [...records].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")), [records]);
  return (
    <Section title={t("project.agent_detail.records_title")} description={t("project.agent_detail.records_desc")}>
      {loading && <Loading />}
      {!loading && sorted.length === 0 && <p className="text-xs text-muted-fg">{t("project.agent_detail.no_activity")}</p>}
      <ul className="space-y-1 text-sm">
        {sorted.map((m, i) => (
          <li key={`${m.ts}-${i}`} className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="mt-0.5 shrink-0">
              {m.direction === "in" ? <ArrowDownLeft size={13} className={toneText.blue} /> : <ArrowUpRight size={13} className={toneText.emerald} />}
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
      <Section title={t("project.agent_detail.sleep_title")} description={t("project.agent_detail.sleep_desc")}>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className={`font-medium ${toneText.amber}`}>{t("project.agent_detail.sleep_deep")}</div>
          <p className="mt-1 text-xs text-muted-fg">{t("project.agent_detail.sleep_deep_desc")}</p>
        </div>
      </Section>
    );
  }
  return (
    <Section title={t("project.agent_detail.sleep_title")} description={t("project.agent_detail.sleep_desc")}>
      <div className="space-y-3">
        {routines.map((r) => {
          const running = r.enabled;
          const err = r.last_status === "error";
          return (
            <div key={r.name} className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", err ? "bg-destructive" : running ? "bg-emerald-400" : "bg-muted-fg/40")} />
                <span className="text-sm font-medium">{r.name}</span>
                <Badge tone={running ? "success" : "muted"}>{running ? t("agents_ui.running") : t("agents_ui.paused")}</Badge>
                {err && <Badge tone="danger">{t("agents_ui.last_error")}</Badge>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Field2 label={t("agents_ui.field_tick")} value={r.schedule} />
                <Field2 label={t("agents_ui.field_next_tick")} value={r.next_run_at ? new Date(r.next_run_at).toLocaleString() : "—"} />
                <Field2 label={t("agents_ui.field_last_tick")} value={r.last_run_at ? new Date(r.last_run_at).toLocaleString() : "—"} />
                <Field2 label={t("agents_ui.field_last_run")} value={r.last_status || "—"} />
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
  const cat = useSWR("/api/tools", () => Tools.list());
  const [draft, setDraft] = useState("");
  const selected = csv(value);
  const catalog = cat.data || [];
  const toggle = (name: string) => {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name); else set.add(name);
    onChange([...set].join(", "));
  };
  const addDraft = () => {
    const name = draft.trim();
    if (!name) return;
    if (!selected.includes(name)) onChange([...selected, name].join(", "));
    setDraft("");
  };
  const custom = selected.filter((s) => !catalog.some((tool) => tool.name === s));
  // The chips ARE the editor (tap to toggle) — no redundant CSV text field.
  // Custom tools not in the catalog are added via the small inline input.
  return (
    <Field label={t("agents_ui.tools_label")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {catalog.map((tool) => {
          const on = selected.includes(tool.name);
          return (
            <Tip key={tool.name} content={tool.description || tool.name}>
              <button type="button" onClick={() => toggle(tool.name)}
                className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                  on ? toneOutline.emerald : "border-border text-muted-fg hover:text-foreground")}>
                {tool.name}
              </button>
            </Tip>
          );
        })}
        {custom.map((s) => (
          <button key={s} type="button" onClick={() => toggle(s)}
            className={cn("rounded-md px-2 py-0.5 font-mono text-[11px]", toneOutline.sky)}>
            {s} ✕
          </button>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }}
          onBlur={addDraft}
          placeholder={t("project.agent_detail.tools_custom_ph")}
          className="h-[23px] w-36 rounded-md border border-dashed border-border bg-transparent px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-fg/60 focus:border-muted-fg"
        />
      </div>
      {/* Chip selection mirrored as CSV text so the list can be copied,
          pasted or bulk-edited; both stay in sync. */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("project.agent_detail.tools_csv_ph")}
          className="h-7 flex-1 rounded-md border border-border bg-muted/30 px-2 font-mono text-[11px] text-muted-fg outline-none focus:border-muted-fg focus:text-foreground"
        />
        <Tip content={t("common.copy")}>
          <button
            type="button"
            onClick={() => { void navigator.clipboard.writeText(csv(value).join(", ")); }}
            aria-label={t("common.copy")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-fg hover:text-foreground"
          >
            <Copy size={12} />
          </button>
        </Tip>
      </div>
    </Field>
  );
}

// Cross-link heuristic: two items are "related" when their titles share a
// meaningful word (ignoring short/stop words). Used to wire tasks↔threads so
// the brain reads as a web, not a wheel.
const STOP = new Set([
  "the", "and", "for", "with", "from", "into", "your", "that", "this", "una", "las", "los",
  "del", "por", "con", "para", "post", "posts", "demo", "week", "weekly",
]);
function keywords(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)),
  );
}
function shareKeyword(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

type BrainAgentFace = {
  slug: string;
  emoji?: string | null;
  icon?: string | null;
  description?: string | null;
  role?: string | null;
  type?: string | null;
};

function brainAgentNode(pid: string, id: string, agent: BrainAgentFace, relation: string): BrainNode {
  return {
    id,
    label: agent.slug,
    kind: "agentlink",
    role: "hub",
    relation,
    slug: agent.slug,
    emoji: agent.emoji || undefined,
    icon: agent.icon || undefined,
    detail: agentPreview(agent),
    href: `/p/${pid}/agents/${agent.slug}`,
    editHref: `/p/${pid}/agents/${agent.slug}?tab=config`,
  };
}

function BrainTab({
  pid, slug, emoji, icon, description, role, type, memory, threads, tasks, routines, parent, children,
}: {
  pid: string;
  slug: string;
  emoji?: string;
  icon?: string;
  description?: string;
  role?: string;
  type?: string;
  memory: string;
  threads: { id: string; label: string }[];
  tasks: { id: string; label: string; detail?: string }[];
  routines: RoutineEntry[];
  parent: BrainAgentFace | null;
  children: BrainAgentFace[];
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const CORE = "__core";
    const agentHref = `/p/${pid}/agents/${slug}`;
    nodes.push({
      id: CORE, label: slug, kind: "agent", role: "core", emoji, icon, relation: "self", slug,
      detail: agentPreview({ description, role, type }),
      href: agentHref,
      editHref: `${agentHref}?tab=config`,
    });

    // A category hub groups its items so items hang off the hub (a two-level
    // tree) instead of all wiring straight to the core.
    const hub = (id: string, label: string, kind: BrainNode["kind"], href?: string) => {
      nodes.push({ id, label, kind, role: "hub", relation: "cluster", href });
      edges.push({ source: CORE, target: id });
    };

    const mem = memoryFacts(memory);
    const th = threads.slice(0, 8);
    const ts = tasks.slice(0, 8);

    if (mem.length) {
      hub("hub-mem", t("agents_ui.kind_memory"), "memory", `${agentHref}?tab=memories`);
      mem.forEach((f, i) => {
        nodes.push({
          id: `m${i}`, label: f, kind: "memory", relation: "knows", detail: f,
          href: `${agentHref}?tab=memories`,
        });
        edges.push({ source: "hub-mem", target: `m${i}` });
      });
    }
    if (th.length) {
      hub("hub-thread", t("agents_ui.kind_thread"), "thread", `/p/${pid}/chat?agent=${slug}`);
      th.forEach((x) => {
        nodes.push({
          id: `th-${x.id}`, label: x.label, kind: "thread", relation: "in_thread",
          href: `/p/${pid}/chat?agent=${slug}&conv=${x.id}`,
        });
        edges.push({ source: "hub-thread", target: `th-${x.id}` });
      });
    }
    if (ts.length) {
      hub("hub-task", t("agents_ui.kind_task"), "task", `/p/${pid}/tasks`);
      ts.forEach((x) => {
        nodes.push({
          id: `ts-${x.id}`, label: x.label, kind: "task", relation: "handles_task",
          detail: clipPreview(x.detail),
          href: `/p/${pid}/tasks?task=${x.id}`,
          editHref: `/p/${pid}/tasks?task=${x.id}&edit=1`,
        });
        edges.push({ source: "hub-task", target: `ts-${x.id}` });
      });
    }
    if (routines.length) {
      hub("hub-routine", t("agents_ui.kind_routine"), "routine", `/p/${pid}/routines`);
      routines.forEach((r) => {
        nodes.push({
          id: `rt-${r.name}`, label: r.name, kind: "routine", relation: "ticks",
          detail: routinePreview(r),
          href: `/p/${pid}/routines?r_id=${encodeURIComponent(r.name)}`,
          editHref: `/p/${pid}/routines?r_id=${encodeURIComponent(r.name)}&edit=1`,
        });
        edges.push({ source: "hub-routine", target: `rt-${r.name}` });
      });
    }
    if (children.length) {
      hub("hub-team", t("agents_ui.kind_hierarchy"), "agentlink", `/p/${pid}/agents`);
      children.forEach((c) => {
        nodes.push(brainAgentNode(pid, `c-${c.slug}`, c, "orchestrates"));
        edges.push({ source: "hub-team", target: `c-${c.slug}` });
      });
    }
    if (parent) {
      nodes.push(brainAgentNode(pid, `p-${parent.slug}`, parent, "reports_to"));
      edges.push({ source: `p-${parent.slug}`, target: CORE });
    }

    // Cross-links: wire a task to a thread that shares a keyword (first match).
    const thKw = th.map((x) => ({ id: `th-${x.id}`, kw: keywords(x.label) }));
    ts.forEach((x) => {
      const kw = keywords(x.label);
      const hit = thKw.find((tk) => shareKeyword(kw, tk.kw));
      if (hit) edges.push({ source: `ts-${x.id}`, target: hit.id });
    });

    return { nodes, edges };
  }, [pid, slug, emoji, icon, description, role, type, memory, threads, tasks, routines, parent, children]);

  return (
    <Section title={t("project.agent_detail.brain_title")} description={t("project.agent_detail.brain_desc")}>
      {nodes.length <= 1
        ? <p className="text-xs text-muted-fg">{t("project.agent_detail.brain_empty")}</p>
        : <BrainGraph nodes={nodes} edges={edges} />}
    </Section>
  );
}
