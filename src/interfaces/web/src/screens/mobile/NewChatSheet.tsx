import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Search, TerminalSquare, Users } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { AgentAvatar, SUPER_AGENT_ICON } from "../../components/agents/AgentAvatar";
import { useInbox } from "../../hooks/useInbox";
import { Groups } from "../../lib/api/groups";
import { Runtimes } from "../../lib/api/runtimes";
import { useProjects } from "../../hooks/useProjects";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import type { InboxRow } from "../../lib/api/inbox";

export type GroupMember = { project_id: number | string; slug: string };

/**
 * "New" on inbox / phone: pick any agent (every project) for a 1:1, or several
 * for a group room — including mixing agents that live in different projects.
 *
 * The list behind this is web-only and hides quiet agents; this sheet asks for
 * the FULL roster (`include_empty`) so an agent you have never opened is still
 * one tap away. a2a rows are conversations between agents, not someone you
 * start a new chat with, so they stay out.
 */
export function NewChatSheet({
  open,
  onClose,
  onPick,
  onGroupCreated,
  onRuntimeStarted,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (row: InboxRow) => void;
  /** After a group is created (possibly cross-project). Caller navigates / selects. */
  onGroupCreated?: (info: {
    id: string;
    title: string;
    participants: string[];
    project_id: number | string;
  }) => void;
  /** After a coding session is launched. Caller navigates to its room. */
  onRuntimeStarted?: (info: { project_id: number | string; session_id: string }) => void;
}) {
  const { rows, isLoading } = useInbox(true, null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"root" | "agent" | "group" | "runtime">("root");
  // The new-session form. Kept flat rather than in an object: four independent
  // fields, and a reset that has to clear all of them when the sheet closes.
  const { projects } = useProjects();
  const [engine, setEngine] = useState("");
  const [runtimePid, setRuntimePid] = useState("");
  const [runtimeCwd, setRuntimeCwd] = useState("");
  const [runtimePrompt, setRuntimePrompt] = useState("");
  const [engines, setEngines] = useState<{ id: string; installed: boolean }[] | null>(null);
  const [groupPick, setGroupPick] = useState<InboxRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode("root");
      setQuery("");
      setGroupPick([]);
      setError(null);
      setCreating(false);
      setEngine("");
      setRuntimeCwd("");
      setRuntimePrompt("");
    }
  }, [open]);

  // Probed by the daemon and cached there: it spawns every coding CLI on the
  // machine to answer, which is fine once and absurd on every render. Asked for
  // only when the menu that needs it is opened.
  useEffect(() => {
    if (mode !== "runtime" || engines) return;
    let alive = true;
    void Runtimes.engines()
      .then((rows) => { if (alive) setEngines(rows); })
      .catch(() => { if (alive) setEngines([]); });
    return () => { alive = false; };
  }, [mode, engines]);

  const installed = useMemo(() => (engines || []).filter((e) => e.installed), [engines]);

  useEffect(() => {
    if (!engine && installed.length) setEngine(installed[0].id);
  }, [installed, engine]);
  useEffect(() => {
    if (!runtimePid && projects.length) setRuntimePid(String(projects[0].id));
  }, [projects, runtimePid]);

  const startRuntime = async () => {
    const prompt = runtimePrompt.trim();
    if (!prompt || !engine || !runtimePid) return;
    setCreating(true);
    setError(null);
    try {
      const out = await Runtimes.start(runtimePid, {
        runtime: engine,
        prompt,
        ...(runtimeCwd.trim() ? { cwd: runtimeCwd.trim() } : {}),
      });
      onRuntimeStarted?.({ project_id: runtimePid, session_id: out.apc_session });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const agents = useMemo(
    () => rows.filter((r) => r.kind === "agent" || r.kind === "super_agent"),
    [rows],
  );

  // Groups need real project agents (tools + .apc). Super-agent stays 1:1 only.
  const groupAgents = useMemo(
    () => agents.filter((r) => r.kind === "agent" && r.project_id != null),
    [agents],
  );

  const q = query.trim().toLowerCase();
  const filterAgents = (list: InboxRow[]) =>
    q
      ? list.filter((r) =>
          [r.agent_name, r.agent_slug, r.project_name]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : list;

  const shown = filterAgents(mode === "group" ? groupAgents : agents);

  const toggleGroup = (row: InboxRow) => {
    setGroupPick((prev) => {
      const key = `${row.project_id}:${row.agent_slug}`;
      const on = prev.some((r) => `${r.project_id}:${r.agent_slug}` === key);
      if (on) return prev.filter((r) => `${r.project_id}:${r.agent_slug}` !== key);
      // Same slug from two projects cannot share a room (@slug would collide).
      if (prev.some((r) => r.agent_slug === row.agent_slug)) {
        setError(t("mobile.group_slug_clash", { slug: row.agent_slug }));
        return prev;
      }
      setError(null);
      return [...prev, row];
    });
  };

  const createGroup = async () => {
    if (groupPick.length < 1 || creating) return;
    setCreating(true);
    setError(null);
    try {
      // Host the ledger on the first pick's project; homes map covers the rest.
      const host = groupPick[0];
      const homePid = host.project_id ?? 0;
      const members: GroupMember[] = groupPick.map((r) => ({
        project_id: r.project_id ?? 0,
        slug: r.agent_slug,
      }));
      const g = await Groups.create(String(homePid), { members });
      onGroupCreated?.({
        id: g.id,
        title: g.title,
        participants: g.participants,
        project_id: homePid,
      });
      onClose();
    } catch (e) {
      setError((e as Error)?.message || t("shared_ui.err_chat_failed"));
    } finally {
      setCreating(false);
    }
  };

  const title =
    mode === "root"
      ? t("mobile.new_chat_title")
      : mode === "group"
        ? t("project.groups.new_title")
        : mode === "runtime"
          ? t("mobile.runtimes_new")
          : t("project.chat.list.pick_agent");

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-0 rounded-t-2xl p-0"
        data-testid="new-chat-sheet"
      >
        <SheetHeader className="gap-3 border-b border-border px-4 pb-3 pt-4">
          <SheetTitle>{title}</SheetTitle>
          {mode !== "root" && mode !== "runtime" && (
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("inbox.search")}
                className="h-10 w-full rounded-full border border-border bg-muted/30 pl-9 pr-3 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
              />
            </div>
          )}
        </SheetHeader>

        {mode === "root" ? (
          <div className="flex flex-col gap-0.5 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              data-testid="new-chat-mode-single"
              onClick={() => setMode("agent")}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent/60"
            >
              <MessageSquare className="size-5 shrink-0 text-muted-fg" />
              <span>
                <span className="block text-[15px] font-medium">{t("project.chat.list.new_single")}</span>
                <span className="block text-[12px] text-muted-fg">{t("project.chat.list.new_single_hint")}</span>
              </span>
            </button>
            {groupAgents.length >= 1 && (
              <button
                type="button"
                data-testid="new-chat-mode-group"
                onClick={() => setMode("group")}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent/60"
              >
                <Users className="size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-[15px] font-medium">{t("project.groups.new_title")}</span>
                  <span className="block text-[12px] text-muted-fg">{t("project.groups.new_hint")}</span>
                </span>
              </button>
            )}
            {/* A coding session. It sits beside the other two because it IS one
                of the conversations this list holds — the engine just answers
                instead of an agent. */}
            <button
              type="button"
              data-testid="new-chat-mode-runtime"
              onClick={() => setMode("runtime")}
              className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent/60"
            >
              <TerminalSquare className="size-5 shrink-0 text-muted-fg" />
              <span>
                <span className="block text-[15px] font-medium">{t("mobile.runtimes_new")}</span>
                <span className="block text-[12px] text-muted-fg">{t("mobile.runtimes_new_hint")}</span>
              </span>
            </button>
          </div>
        ) : mode === "runtime" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {engines === null && <p className="text-sm text-muted-fg">{t("common.loading")}</p>}
            {engines !== null && !installed.length && (
              <p className="text-sm text-muted-fg" data-testid="new-runtime-none">{t("mobile.runtimes_none_installed")}</p>
            )}
            {!!installed.length && (
              <>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-fg">{t("mobile.runtimes_new_engine")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {installed.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        data-testid={`new-runtime-engine-${e.id}`}
                        onClick={() => setEngine(e.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]",
                          engine === e.id ? "border-primary bg-primary/10" : "border-border",
                        )}
                      >
                        <AgentAvatar icon={e.id} emoji={null} name={e.id} size={16} />
                        {e.id}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-fg">{t("nav.project")}</span>
                  <select
                    value={runtimePid}
                    onChange={(ev) => setRuntimePid(ev.target.value)}
                    data-testid="new-runtime-project"
                    className="h-10 w-full rounded-lg border border-border bg-muted/30 px-2 text-[15px] outline-none focus:border-primary/50"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name || p.path}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-fg">{t("mobile.runtimes_new_where")}</span>
                  <input
                    value={runtimeCwd}
                    onChange={(ev) => setRuntimeCwd(ev.target.value)}
                    placeholder="/Volumes/…"
                    data-testid="new-runtime-cwd"
                    className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
                  />
                  <span className="block text-[11px] text-muted-fg">{t("mobile.runtimes_new_where_hint")}</span>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-fg">{t("mobile.runtimes_new_prompt")}</span>
                  <textarea
                    value={runtimePrompt}
                    onChange={(ev) => setRuntimePrompt(ev.target.value)}
                    rows={4}
                    autoFocus
                    data-testid="new-runtime-prompt"
                    className="w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
                  />
                </label>

                {error && <p className="text-[12px] text-red-500">{error}</p>}

                <button
                  type="button"
                  onClick={() => void startRuntime()}
                  disabled={creating || !runtimePrompt.trim() || !engine}
                  data-testid="new-runtime-start"
                  className="h-10 rounded-lg bg-primary px-4 text-[15px] font-medium text-primary-fg disabled:opacity-50"
                >
                  {t("mobile.runtimes_new_start")}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {isLoading && (
                <p className="px-4 py-8 text-center text-sm text-muted-fg">{t("common.loading")}</p>
              )}
              {!isLoading && !shown.length && (
                <p className="px-4 py-8 text-center text-sm text-muted-fg">{t("mobile.new_chat_empty")}</p>
              )}
              {mode === "agent" &&
                shown.map((row) => (
                  <AgentPick
                    key={`${row.project_id}:${row.agent_slug}`}
                    row={row}
                    onPick={(r) => {
                      onPick(r);
                      onClose();
                    }}
                  />
                ))}
              {mode === "group" &&
                shown.map((row) => {
                  const key = `${row.project_id}:${row.agent_slug}`;
                  const on = groupPick.some((r) => `${r.project_id}:${r.agent_slug}` === key);
                  const order = on ? groupPick.findIndex((r) => `${r.project_id}:${r.agent_slug}` === key) + 1 : 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      data-testid={`new-group-${row.agent_slug}`}
                      onClick={() => toggleGroup(row)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/60"
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {on ? order : ""}
                      </span>
                      <AgentAvatar
                        icon={row.agent_icon}
                        emoji={row.agent_emoji}
                        name={row.agent_name || row.agent_slug}
                        size={40}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {row.agent_name || row.agent_slug}
                        </span>
                        <span className="block truncate text-[12px] text-muted-fg">
                          {row.project_name || row.agent_slug}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </div>
            {mode === "group" && (
              <div className="shrink-0 border-t border-border px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                {error && <p className="mb-2 px-1 text-[12px] text-destructive">{error}</p>}
                <p className="mb-2 px-1 text-[11px] text-muted-fg">{t("project.groups.first_hint")}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("root");
                      setGroupPick([]);
                      setQuery("");
                      setError(null);
                    }}
                    className="flex-1 rounded-full px-3 py-2.5 text-sm text-muted-fg active:bg-accent/60"
                  >
                    {t("mobile.back")}
                  </button>
                  <button
                    type="button"
                    data-testid="new-group-create"
                    disabled={groupPick.length < 1 || creating}
                    onClick={() => void createGroup()}
                    className="flex-1 rounded-full bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {t("project.groups.create")}
                  </button>
                </div>
              </div>
            )}
            {mode === "agent" && (
              <div className="shrink-0 border-t border-border px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => {
                    setMode("root");
                    setQuery("");
                  }}
                  className="w-full rounded-full px-3 py-2.5 text-sm text-muted-fg active:bg-accent/60"
                >
                  {t("mobile.back")}
                </button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AgentPick({ row, onPick }: { row: InboxRow; onPick: (row: InboxRow) => void }) {
  const isSuper = row.kind === "super_agent";
  const name = row.agent_name || row.agent_slug;
  return (
    <button
      type="button"
      data-testid={`new-chat-${row.agent_slug}`}
      onClick={() => onPick(row)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/60"
    >
      <AgentAvatar
        icon={isSuper ? row.agent_icon || SUPER_AGENT_ICON : row.agent_icon}
        emoji={row.agent_emoji}
        name={name}
        size={40}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{name}</span>
        <span className={cn("block truncate text-[12px] text-muted-fg")}>
          {isSuper ? t("agents_ui.super_agent_badge") : row.project_name || row.agent_slug}
        </span>
      </span>
    </button>
  );
}
