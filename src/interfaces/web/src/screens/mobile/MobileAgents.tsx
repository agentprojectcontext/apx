import { useMemo, useState } from "react";
import useSWR from "swr";
import { useNavigate } from "react-router-dom";
import { Check, MessageSquare, Pencil, Users, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { AgentAvatar } from "../../components/agents/AgentAvatar";
import { AgentIconPicker } from "../../components/agents/AgentFormFields";
import { Agents, type DirectoryAgent } from "../../lib/api/agents";
import { chatPath } from "./routes";
import { MobileChip, MobileGroupHeader, MobileListHeader } from "./mobileList";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Every agent, everywhere — the phone's contact list.
 *
 * Asked for on 2026-09-20: "una vista nueva en mobile que permita ver el 100%
 * de agentes separados por proyectos […] es una vista simplificada que me
 * permite buscarlos como si fueran contactos".
 *
 * NOT THE INBOX, and that is the whole point. The chat list shows
 * CONVERSATIONS, so it can only ever show agents somebody has already written
 * to — which excludes exactly the agent you open a directory to find. It also
 * knows nothing about an agent's area, where it sits in the tree, or what its
 * prompt says.
 *
 * Grouped by project because that is how agents are actually organised, and
 * ordered as a TREE inside each group: an orchestrator, then the agents that
 * name it as parent, indented. A flat alphabetical list of sixteen agents says
 * nothing about who answers to whom, which is the first thing you want to know
 * about somebody else's project.
 */
export function MobileAgents() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryAgent | null>(null);

  const { data, isLoading, mutate } = useSWR("mobile-agents", () => Agents.directory(), {
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  const agents = useMemo(() => data ?? [], [data]);

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of agents) {
      const id = String(a.project_id);
      if (!seen.has(id)) seen.set(id, a.project_name?.split("/").pop() || id);
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [agents]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    let out = agents;
    if (project) out = out.filter((a) => String(a.project_id) === project);
    if (q) {
      out = out.filter((a) => [a.name, a.slug, a.role, a.area, a.description, a.project_name]
        .some((f) => String(f || "").toLowerCase().includes(q)));
    }
    return out;
  }, [agents, project, q]);

  // One group per project, each one a tree. A search that matched a child but
  // not its parent still shows the child — filtering is about finding somebody,
  // not about pruning branches.
  const groups = useMemo(() => {
    const byProject = new Map<string, { id: string; name: string; rows: { agent: DirectoryAgent; depth: number }[] }>();
    for (const a of shown) {
      const id = String(a.project_id);
      if (!byProject.has(id)) {
        byProject.set(id, { id, name: a.project_name?.split("/").pop() || id, rows: [] });
      }
    }
    for (const group of byProject.values()) {
      const mine = shown.filter((a) => String(a.project_id) === group.id);
      const slugs = new Set(mine.map((a) => a.slug));
      // A parent that is not in this list (filtered out, or in another project)
      // cannot indent anybody: its children are roots here.
      const childrenOf = (parent: string | null) =>
        mine.filter((a) => (a.parent && slugs.has(a.parent) ? a.parent : null) === parent)
          .sort((x, y) => Number(!!y.is_master) - Number(!!x.is_master)
            || String(x.name || x.slug).localeCompare(String(y.name || y.slug)));
      const walk = (parent: string | null, depth: number) => {
        for (const agent of childrenOf(parent)) {
          group.rows.push({ agent, depth });
          // Two levels is as deep as the indent goes — past that a phone row is
          // all margin and no name.
          walk(agent.slug, Math.min(depth + 1, 2));
        }
      };
      walk(null, 0);
    }
    return [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [shown]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader
        title={t("mobile.agents_title")}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={t("mobile.agents_search")}
        filters={projects.length > 1 ? [
          <MobileChip key="all" active={project === null} onClick={() => setProject(null)} testId="mobile-agents-filter-all">
            {t("mobile.agents_all_projects")}
          </MobileChip>,
          ...projects.map((p) => (
            <MobileChip
              key={p.id}
              active={project === p.id}
              onClick={() => setProject((cur) => (cur === p.id ? null : p.id))}
              testId={`mobile-agents-filter-${p.id}`}
            >
              {p.name}
            </MobileChip>
          )),
        ] : undefined}
      />

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mobile-agents-list">
        {isLoading && !data && <div className="py-10"><Loading /></div>}

        {!isLoading && shown.length === 0 && (
          <p className="px-4 py-16 text-center text-sm text-muted-fg">
            <Users size={20} className="mx-auto mb-2 opacity-50" />
            {q ? t("inbox.no_match") : t("mobile.agents_empty")}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.id}>
            <MobileGroupHeader label={group.name} count={group.rows.length} />
            <ul className="divide-y divide-border/60">
              {group.rows.map(({ agent, depth }) => (
                <AgentRow key={`${agent.project_id}-${agent.slug}`} agent={agent} depth={depth} onOpen={() => setOpen(agent)} />
              ))}
            </ul>
          </section>
        ))}
        <div className="h-4" />
      </div>

      <AgentSheet
        agent={open}
        onClose={() => setOpen(null)}
        onChanged={() => void mutate()}
        onChat={(a) => { setOpen(null); navigate(chatPath(String(a.project_id), a.slug)); }}
      />
    </div>
  );
}

/** One contact: face, name, and the one line that says what it is for. */
function AgentRow({ agent, depth, onOpen }: {
  agent: DirectoryAgent;
  depth: number;
  onOpen: () => void;
}) {
  const subtitle = [agent.role, agent.area].filter(Boolean).join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-agent-${agent.slug}`}
        className="flex w-full min-w-0 items-center gap-3 py-3 pr-4 text-left active:bg-accent/50"
        style={{ paddingLeft: 16 + depth * 18 }}
      >
        <AgentAvatar icon={agent.icon} emoji={agent.emoji} name={agent.name || agent.slug} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[15px] font-medium">{agent.name || agent.slug}</span>
            {agent.is_master && (
              <span className="shrink-0 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                {t("mobile.agents_master")}
              </span>
            )}
          </span>
          {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-fg">{subtitle}</span>}
          {agent.system_preview && (
            <span className="mt-0.5 block truncate text-[11px] text-muted-fg/70">{agent.system_preview}</span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * One agent, opened from the directory.
 *
 * Read-heavy on purpose: what it is told, what it can reach, what it knows. The
 * two things it EDITS are the two the owner asked for — the display name and
 * the avatar — because those are the ones you fix when you are looking at a
 * list and something is wrong. Everything else about an agent is a decision,
 * and decisions are made on the panel where the whole card is visible.
 */
function AgentSheet({ agent, onClose, onChanged, onChat }: {
  agent: DirectoryAgent | null;
  onClose: () => void;
  onChanged: () => void;
  onChat: (agent: DirectoryAgent) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  // The full prompt only when it is asked for: the list carries a preview, and
  // a detail request per agent is what the directory exists to avoid.
  const { data: full } = useSWR(
    agent && showPrompt ? `/api/projects/${agent.project_id}/agents/${agent.slug}` : null,
    () => Agents.get(String(agent!.project_id), agent!.slug),
  );

  if (!agent) return null;

  const startEdit = () => {
    setName(agent.name || "");
    setIcon(agent.icon || "");
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await Agents.update(String(agent.project_id), agent.slug, { name: name.trim() || null, icon: icon || null });
      toast.success(t("mobile.agents_saved"));
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!agent} onOpenChange={(v) => { if (!v) { setEditing(false); setShowPrompt(false); onClose(); } }}>
      <SheetContent side="bottom" className="flex max-h-[88vh] flex-col p-0">
        <SheetHeader className="shrink-0 space-y-2 border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <AgentAvatar icon={agent.icon} emoji={agent.emoji} name={agent.name || agent.slug} size={44} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-left text-base">{agent.name || agent.slug}</SheetTitle>
              <p className="truncate text-xs text-muted-fg">
                {[agent.slug, agent.project_name?.split("/").pop()].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {editing ? (
            <div className="space-y-4" data-testid="mobile-agent-edit">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-fg">{t("mobile.agents_name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={agent.slug}
                  className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3 text-[15px] outline-none focus:border-primary/50"
                />
              </label>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-fg">{t("mobile.agents_avatar")}</span>
                <AgentIconPicker icon={icon} onIcon={setIcon} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {agent.description && <p className="text-[13px] leading-relaxed">{agent.description}</p>}

              <Facts agent={agent} />

              {agent.skills.length > 0 && (
                <Chips label={t("mobile.agents_skills")} items={agent.skills} testId="mobile-agent-skills" />
              )}
              {agent.tools.length > 0 && (
                <Chips label={t("mobile.agents_tools")} items={agent.tools} testId="mobile-agent-tools" />
              )}
              {agent.tools.length === 0 && (
                <p className="text-[11px] text-muted-fg">{t("mobile.agents_tools_default")}</p>
              )}

              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-fg">{t("mobile.agents_prompt")}</span>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-[12px] leading-relaxed text-muted-fg">
                  {showPrompt ? (full?.system ?? t("common.loading")) : agent.system_preview}
                </p>
                {agent.system_more && !showPrompt && (
                  <button
                    type="button"
                    onClick={() => setShowPrompt(true)}
                    data-testid="mobile-agent-prompt-more"
                    className="text-xs font-medium text-primary"
                  >
                    {t("mobile.agents_prompt_more")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy}
                data-testid="mobile-agent-save"
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-fg disabled:opacity-60"
              >
                <Check size={16} /> {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex size-10 items-center justify-center rounded-lg border border-border text-muted-fg"
                aria-label={t("common.cancel")}
              >
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onChat(agent)}
                data-testid="mobile-agent-chat"
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-fg"
              >
                <MessageSquare size={16} /> {t("mobile.agents_chat")}
              </button>
              <button
                type="button"
                onClick={startEdit}
                data-testid="mobile-agent-edit-open"
                className="flex size-10 items-center justify-center rounded-lg border border-border text-muted-fg"
                aria-label={t("common.edit")}
              >
                <Pencil size={16} />
              </button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The card's definitional fields, as a compact two-column list. */
function Facts({ agent }: { agent: DirectoryAgent }) {
  const rows: [string, string | null | undefined][] = [
    [t("mobile.agents_role"), agent.role],
    [t("mobile.agents_area"), agent.area],
    [t("mobile.agents_type"), agent.type],
    [t("mobile.agents_model"), agent.model],
    [t("mobile.agents_autonomy"), agent.autonomy],
    [t("mobile.agents_parent"), agent.parent],
  ];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]" data-testid="mobile-agent-facts">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-fg">{label}</dt>
          <dd className="min-w-0 truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ label, items, testId }: { label: string; items: string[]; testId: string }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <span className="text-xs font-medium text-muted-fg">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((x) => (
          <span key={x} className={cn("rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-fg")}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}
