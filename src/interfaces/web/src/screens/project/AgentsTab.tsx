import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { Bot, Crown, Eye, GitBranch, List, Plus, Send, Sparkles, Upload, Wrench } from "lucide-react";
import { Agents } from "../../lib/api";
import type { AgentEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

const LANGS = ["", "es", "en", "pt", "fr", "it", "de"];
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function agentVisual(a: AgentEntry) {
  return a.is_master
    ? { gradient: "from-violet-600 to-indigo-600", Icon: Crown }
    : { gradient: "from-slate-600 to-gray-600", Icon: Bot };
}

// Build parent→children map with panda's single-orchestrator fallback: if there
// is exactly one master and an agent has no explicit parent, treat it as a child.
function buildTree(agents: AgentEntry[]) {
  const masters = agents.filter((a) => a.is_master);
  const soleMaster = masters.length === 1 ? masters[0] : null;
  const parentOf = (a: AgentEntry): string | null => {
    if (a.parent) return a.parent;
    if (soleMaster && !a.is_master && a.slug !== soleMaster.slug) return soleMaster.slug;
    return null;
  };
  const childrenByParent = new Map<string, AgentEntry[]>();
  const roots: AgentEntry[] = [];
  for (const a of agents) {
    const p = parentOf(a);
    if (p && agents.some((x) => x.slug === p)) {
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(a);
    } else {
      roots.push(a);
    }
  }
  return { roots, childrenByParent };
}

export function AgentsTab({ pid }: { pid: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const [view, setView] = useState<"hierarchy" | "list">("hierarchy");
  const [creating, setCreating] = useState(false);

  const [importing, setImporting] = useState(false);
  const agents = list.data || [];
  const open = (slug: string) => navigate(`/p/${pid}/agents/${slug}`);
  const chat = (slug?: string) => navigate(slug ? `/p/${pid}/chat?agent=${slug}` : `/p/${pid}/chat`);
  const { roots, childrenByParent } = useMemo(() => buildTree(agents), [agents]);

  return (
    <Section
      title={t("project.agents.title")}
      description={t("project.agents.subtitle_full")}
      action={
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button onClick={() => setView("hierarchy")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs", view === "hierarchy" ? "bg-accent text-accent-fg" : "text-muted-fg")}>
              <GitBranch size={13} /> {t("project.agents.hierarchy")}
            </button>
            <button onClick={() => setView("list")} className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-xs", view === "list" ? "bg-accent text-accent-fg" : "text-muted-fg")}>
              <List size={13} /> {t("project.agents.list_view")}
            </button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            <Upload size={13} /> {t("project.agents.import")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => chat()}><Send size={13} /> {t("project.agents.chat")}</Button>
          <Button size="sm" variant="primary" data-testid="agent-new" onClick={() => setCreating(true)}><Plus size={14} /> {t("project.agents.new")}</Button>
        </div>
      }
    >
      {list.isLoading && <Loading />}
      {!list.isLoading && agents.length === 0 && (
        <Empty>{t("project.agents.empty_text")}</Empty>
      )}

      {!list.isLoading && agents.length > 0 && (
        view === "hierarchy"
          ? <HierarchyView roots={roots} childrenByParent={childrenByParent} onOpen={open} onChat={chat} />
          : <ListView agents={agents} onOpen={open} onChat={chat} />
      )}

      <CreateAgentDialog
        open={creating}
        pid={pid}
        agents={agents}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); list.mutate(); }}
      />
      <ImportVaultDialog
        open={importing}
        pid={pid}
        existing={agents.map((a) => a.slug)}
        onClose={() => setImporting(false)}
        onImported={() => list.mutate()}
      />
    </Section>
  );
}

function ImportVaultDialog({
  open, onClose, onImported, pid, existing,
}: { open: boolean; onClose: () => void; onImported: () => void; pid: string; existing: string[] }) {
  const toast = useToast();
  const vault = useSWR(open ? "/agents/vault" : null, () => Agents.vault());
  const [busy, setBusy] = useState("");
  const items = vault.data || [];

  const doImport = async (slug: string) => {
    setBusy(slug);
    try { await Agents.import(pid, slug); toast.success(t("project.agents.import_success", { slug })); onImported(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.agents.import_title")}
      description={t("project.agents.import_desc")}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
    >
      {vault.isLoading && <Loading />}
      {!vault.isLoading && items.length === 0 && <Empty>{t("project.agents.import_empty")}</Empty>}
      <ul className="space-y-2">
        {items.map((a) => {
          const already = existing.includes(a.slug);
          return (
            <li key={a.slug} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Bot size={16} className="shrink-0 text-muted-fg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{a.slug}</span>
                  {a.is_master && <Badge tone="success"><Crown size={9} /> {t("project.agents.orchestrator")}</Badge>}
                  {a.model && <Badge tone="info">{a.model}</Badge>}
                </div>
                {a.description && <p className="truncate text-xs text-muted-fg">{a.description}</p>}
              </div>
              <Button size="sm" variant="primary" disabled={already || busy === a.slug} loading={busy === a.slug} onClick={() => doImport(a.slug)}>
                {already ? t("project.agents.import_already") : t("project.agents.import_btn")}
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function HierarchyView({
  roots, childrenByParent, onOpen, onChat,
}: {
  roots: AgentEntry[];
  childrenByParent: Map<string, AgentEntry[]>;
  onOpen: (slug: string) => void;
  onChat: (slug: string) => void;
}) {
  return (
    <div className="space-y-8">
      {roots.map((root) => {
        const kids = childrenByParent.get(root.slug) || [];
        return (
          <div key={root.slug} className="flex flex-col items-center">
            <AgentCard agent={root} onOpen={onOpen} onChat={onChat} wide />
            {kids.length > 0 && (
              <>
                <div className="h-5 w-px bg-border" />
                <div className="flex flex-wrap items-start justify-center gap-4 border-t border-border pt-5">
                  {kids.map((k) => (
                    <div key={k.slug} className="flex flex-col items-center">
                      <AgentCard agent={k} onOpen={onOpen} onChat={onChat} />
                      {(childrenByParent.get(k.slug) || []).length > 0 && (
                        <>
                          <div className="h-4 w-px bg-border" />
                          <div className="flex flex-wrap justify-center gap-3 border-t border-border pt-4">
                            {(childrenByParent.get(k.slug) || []).map((g) => (
                              <AgentCard key={g.slug} agent={g} onOpen={onOpen} onChat={onChat} compact />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgentCard({
  agent, onOpen, onChat, wide, compact,
}: {
  agent: AgentEntry;
  onOpen: (slug: string) => void;
  onChat: (slug: string) => void;
  wide?: boolean;
  compact?: boolean;
}) {
  const { gradient, Icon } = agentVisual(agent);
  return (
    <div
      data-testid={`agent-card-${agent.slug}`}
      className={cn(
        "cursor-pointer rounded-xl border border-border bg-card p-3 transition-colors hover:border-muted-fg/50",
        wide ? "w-64" : compact ? "w-44" : "w-52",
      )}
      onClick={() => onOpen(agent.slug)}
    >
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br", gradient)}>
          <Icon className="size-4 text-white" />
        </div>
        <span className="truncate text-sm font-semibold">{agent.slug}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {agent.is_master && <Badge tone="success"><Crown size={9} /> {t("project.agents.orchestrator")}</Badge>}
        {agent.role && <Badge>{agent.role}</Badge>}
        {agent.model && !compact && <Badge tone="info">{agent.model}</Badge>}
      </div>
      <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-xs text-muted-fg" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onOpen(agent.slug)} className="flex items-center gap-1 hover:text-foreground"><Eye size={12} /> {t("project.agents.view")}</button>
        <button onClick={() => onChat(agent.slug)} className="flex items-center gap-1 text-emerald-500 hover:text-emerald-400"><Send size={12} /> {t("project.agents.chat")}</button>
      </div>
    </div>
  );
}

function ListView({ agents, onOpen, onChat }: { agents: AgentEntry[]; onOpen: (slug: string) => void; onChat: (slug: string) => void }) {
  const sorted = [...agents].sort((a, b) => Number(!!b.is_master) - Number(!!a.is_master) || a.slug.localeCompare(b.slug));
  return (
    <div className="space-y-2">
      {sorted.map((a) => {
        const { gradient, Icon } = agentVisual(a);
        return (
          <div key={a.slug} data-testid={`agent-card-${a.slug}`} className="flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-muted/30 p-3 hover:border-muted-fg/50" onClick={() => onOpen(a.slug)}>
            <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br", gradient)}>
              <Icon className="size-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{a.slug}</span>
                {a.is_master && <Badge tone="success"><Crown size={10} /> {t("project.agents.orchestrator")}</Badge>}
                {a.role && <Badge>{a.role}</Badge>}
                {a.model && <Badge tone="info">{a.model}</Badge>}
                {a.parent && <span className="text-[10px] text-violet-400">↳ {a.parent}</span>}
              </div>
              {a.description && <p className="mt-1 truncate text-xs text-muted-fg">{a.description}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                {a.skills?.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Sparkles size={9} /> {s}</span>)}
                {a.tools?.map((tl) => <span key={tl} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Wrench size={9} /> {tl}</span>)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-fg" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => onOpen(a.slug)} className="flex items-center gap-1 hover:text-foreground"><Eye size={12} /> {t("project.agents.view")}</button>
              <button onClick={() => onChat(a.slug)} className="flex items-center gap-1 text-emerald-500 hover:text-emerald-400"><Send size={12} /> {t("project.agents.chat")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateAgentDialog({
  open, onClose, onCreated, pid, agents,
}: { open: boolean; onClose: () => void; onCreated: () => void; pid: string; agents: AgentEntry[] }) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("");
  const [tools, setTools] = useState("");
  const [isMaster, setIsMaster] = useState(false);
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSlug(""); setRole(""); setModel(""); setLanguage("");
    setDescription(""); setSkills(""); setTools(""); setIsMaster(false); setParent("");
  };

  const submit = async () => {
    if (!/^[a-z][a-z0-9_-]*$/.test(slug)) { toast.error(t("project.agents.slug_invalid")); return; }
    setBusy(true);
    try {
      await Agents.create(pid, {
        slug,
        role: role || undefined,
        model: model || undefined,
        language: language || undefined,
        description: description || undefined,
        skills: csv(skills),
        tools: csv(tools),
        is_master: isMaster,
        parent: parent || undefined,
      });
      toast.success(t("project.agents.create_success", { slug }));
      onCreated();
      reset();
    } catch (e: any) { toast.error(e?.message || t("project.agents.create_error")); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.agents.new_title")}
      description={t("project.agents.new_desc")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" data-testid="agent-create-submit" onClick={submit} loading={busy}>{t("common.create")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("project.agents.slug_label")}><Input autoFocus data-testid="agent-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("project.agents.slug_ph")} /></Field>
          <Field label={t("project.agents.role_label")}><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("project.agents.role_ph")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("project.agents.model_label")} hint={t("project.agents.model_hint")}><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
          <Field label={t("project.agents.lang_label")}><UiSelect value={language} onChange={setLanguage} options={LANGS.map((l) => ({ value: l, label: l || "—" }))} /></Field>
        </div>
        <Field label={t("project.agents.desc_label")}><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("project.agents.desc_ph")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("project.agents.skills_label")}><Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t("project.agents.skills_ph")} /></Field>
          <Field label={t("project.agents.tools_label")}><Input value={tools} onChange={(e) => setTools(e.target.value)} placeholder={t("project.agents.tools_ph")} /></Field>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label={t("project.agents.parent_label")} hint={t("project.agents.parent_hint")}>
            <UiSelect
              value={parent}
              onChange={setParent}
              placeholder={t("project.agents.none_parent")}
              options={[{ value: "", label: t("project.agents.none_parent") }, ...agents.filter((a) => a.slug !== slug).map((a) => ({ value: a.slug, label: a.slug }))]}
            />
          </Field>
          <Switch checked={isMaster} onChange={setIsMaster} label={t("project.agents.master_label")} />
        </div>
      </div>
    </Dialog>
  );
}
