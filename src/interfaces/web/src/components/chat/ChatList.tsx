import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import useSWR from "swr";
import clsx from "clsx";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  MessageSquare,
  Mic,
  Monitor,
  Plus,
  Send,
  Timer,
  Users,
} from "lucide-react";
import { Conversations } from "../../lib/api";
import { AgentAvatar, AgentAvatarGroup, SUPER_AGENT_ICON, type AgentFace } from "../agents/AgentAvatar";
import { Input, Loading, Switch } from "../ui";
import { UiSelect } from "../UiSelect";
import { t } from "../../i18n";
import type { AgentEntry, ConversationListEntry, ThreadListEntry } from "../../types/daemon";

// Channel taxonomy — same channels the daemon writes ("web", "voice",
// "desktop", "telegram", …) folded into sidebar groups. Each group has an
// icon + a fixed display order so the sidebar is stable across reloads. Web is
// pinned first (it's where chats started from this UI land), then the remote
// channels, with the catch-all "other" last.
export type ChannelGroupKey =
  | "web"
  | "telegram"
  | "desktop"
  | "voice"
  | "a2a"
  | "group"
  | "schedule"
  | "other";

interface GroupMeta {
  label: string;
  icon: ElementType;
  order: number;
}

const GROUP_META: Record<ChannelGroupKey, GroupMeta> = {
  web:      { label: "Web", icon: MessageSquare, order: 0 },
  telegram: { label: "Telegram", icon: Send, order: 1 },
  desktop:  { label: "Desktop", icon: Monitor, order: 2 },
  voice:    { label: "Voice", icon: Mic, order: 3 },
  a2a:      { label: "Agent ↔ Agent", icon: Bot, order: 4 },
  group:    { label: "Groups", icon: Users, order: 5 },
  schedule: { label: "Schedule", icon: Timer, order: 6 },
  other:    { label: "Other", icon: FolderOpen, order: 7 },
};

function channelGroup(channel?: string): ChannelGroupKey {
  if (!channel) return "web";
  const c = channel.toLowerCase();
  if (c === "telegram") return "telegram";
  if (c === "voice" || c === "overlay") return "voice";
  if (c === "desktop") return "desktop";
  if (c === "web" || c === "sidebar" || c === "web-sidebar") return "web";
  if (c === "a2a" || c.startsWith("agent")) return "a2a";
  if (c === "group") return "group";
  if (c === "schedule" || c === "cron" || c === "routine") return "schedule";
  return "other";
}

// Composite key identifying a sidebar selection: a "live" agent session (no
// conversation file yet), a persisted conversation tied to an agent, or a
// super-agent channel thread from the global message ledger.
export type ChatKey =
  | { kind: "live"; agentSlug: string }
  | { kind: "conv"; agentSlug: string; convId: string }
  | { kind: "thread"; channel: string; threadId: string };

export function chatKeyToString(k: ChatKey): string {
  if (k.kind === "live") return `live:${k.agentSlug}`;
  if (k.kind === "conv") return `conv:${k.agentSlug}:${k.convId}`;
  return `thread:${k.channel}:${k.threadId}`;
}

/** Display metadata carried alongside a selection so the right-pane header can
 *  show "Created {date} · {channel} · {agent}" without a second fetch. */
export interface ChatSelectionMeta {
  channel?: string;
  createdAt?: string;
  title?: string;
  /** Reached from the archived group: the ⋯ menu offers to take it back out
   *  rather than to put it away again. */
  archived?: boolean;
}

interface Props {
  pid: string;
  agents: AgentEntry[];
  /** Virtual super-agent slug used by the dropdown (kept in sync with ChatTab). */
  superAgentSlug: string;
  superAgentLabel: string;
  superAgentIcon?: string;
  selected: ChatKey;
  onSelect: (key: ChatKey, meta?: ChatSelectionMeta) => void;
  /** Start a fresh in-memory session with the chosen agent (super-agent or a
   *  project agent). It materialises in the Web group on the first message. */
  onNewChat: (agentSlug: string) => void;
  /** Create a group room with the chosen agents and open it.
   *  `showTools` is the initial transcript layout preference for that room. */
  onNewGroup?: (agentSlugs: string[], opts?: { showTools?: boolean }) => void;
  /** Nothing was chosen for us (no deep link, no host selection) — open this
   *  project's most recent chat once the lists land. */
  autoSelectLatest?: boolean;
}

// Per-agent SWR fetcher. Lives in a child so adding/removing agents doesn't
// violate the rules of hooks in the parent.
function AgentConvFetcher({
  pid,
  slug,
  onLoaded,
}: {
  pid: string;
  slug: string;
  onLoaded: (slug: string, data: ConversationListEntry[] | undefined) => void;
}) {
  const { data } = useSWR(
    `/api/projects/${pid}/agents/${slug}/conversations`,
    () => Conversations.list(pid, slug),
    { revalidateOnFocus: false },
  );
  // Bubble fetched data up to the parent on every change.
  useEffect(() => {
    onLoaded(slug, data);
  }, [slug, data]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function ChatList({
  pid,
  agents,
  superAgentSlug,
  superAgentLabel,
  superAgentIcon = SUPER_AGENT_ICON,
  selected,
  onSelect,
  onNewChat,
  onNewGroup,
  autoSelectLatest = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Partial<Record<ChannelGroupKey, boolean>>>({});
  const [byAgent, setByAgent] = useState<Record<string, ConversationListEntry[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // The "+ New" picker asks first WHAT to start (a 1:1 or a group), then WHO.
  const [pickerMode, setPickerMode] = useState<"root" | "agent" | "group">("root");
  const [groupPick, setGroupPick] = useState<string[]>([]);
  // Initial transcript layout for the new room — same switch that will sit in
  // the chat header after create. Off = pelado (text only); on = tools visible.
  const [groupShowTools, setGroupShowTools] = useState(false);
  const openPicker = () => { setPickerOpen(true); setPickerMode("root"); setGroupPick([]); setGroupShowTools(false); };
  const closePicker = () => { setPickerOpen(false); setPickerMode("root"); setGroupPick([]); setGroupShowTools(false); };

  // Super-agent channel threads (telegram, web quick-chat, desktop …) come from
  // the global message ledger, scoped by the daemon to the project this screen
  // is showing: each project lists its own conversations, and the general
  // workspace (pid "0") owns the channels that have no project of their own —
  // Telegram and desktop talk to the super-agent there. Inside the project, the
  // channel groups below stay as they are: a project routing its own Telegram
  // gets a Telegram group with just those chats in it.
  const threadsQ = useSWR(
    `/api/projects/${pid}/super-agent/threads`,
    () => Conversations.threads(pid),
    { revalidateOnFocus: false },
  );

  const handleLoaded = (slug: string, data: ConversationListEntry[] | undefined) => {
    if (!data) return;
    setByAgent((prev) => {
      const cur = prev[slug];
      if (cur && cur.length === data.length && cur === data) return prev;
      return { ...prev, [slug]: data };
    });
  };

  const allConvs = useMemo<ConversationListEntry[]>(() => {
    const out: ConversationListEntry[] = [];
    for (const a of agents) {
      for (const c of byAgent[a.slug] || []) {
        out.push({ ...c, agent_slug: c.agent_slug || a.slug });
      }
    }
    return out;
  }, [agents, byAgent]);

  const filteredConvs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allConvs.filter((c) => {
      if (agentFilter && c.agent_slug !== agentFilter) return false;
      if (q) {
        const hay = `${c.title || ""} ${c.id} ${c.agent_slug}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allConvs, query, agentFilter]);

  // Threads belong to the super-agent: visible with no agent filter or when
  // the filter is the super-agent itself.
  const filteredThreads = useMemo<ThreadListEntry[]>(() => {
    if (agentFilter && agentFilter !== superAgentSlug) return [];
    const q = query.trim().toLowerCase();
    return (threadsQ.data || []).filter((th) => {
      if (!q) return true;
      return `${th.title} ${th.id} ${th.channel}`.toLowerCase().includes(q);
    });
  }, [threadsQ.data, query, agentFilter, superAgentSlug]);

  // Group: live entries (one per applicable agent) + stored conversations and
  // super-agent channel threads, folded together by channel.
  type GroupItem =
    | { type: "conv"; conv: ConversationListEntry; sortTs: string }
    | { type: "thread"; thread: ThreadListEntry; sortTs: string };

  const groups = useMemo(() => {
    const byKey = new Map<ChannelGroupKey, GroupItem[]>();
    const push = (key: ChannelGroupKey, item: GroupItem) => {
      const bucket = byKey.get(key);
      if (bucket) bucket.push(item);
      else byKey.set(key, [item]);
    };
    for (const c of filteredConvs) {
      push(channelGroup(c.channel), { type: "conv", conv: c, sortTs: c.started_at || "" });
    }
    for (const th of filteredThreads) {
      push(channelGroup(th.channel), { type: "thread", thread: th, sortTs: th.last_ts || th.started_at || "" });
    }
    return Array.from(byKey.entries())
      .map(([key, items]) => ({
        key,
        items: items.sort(
          (a, b) => new Date(b.sortTs || 0).getTime() - new Date(a.sortTs || 0).getTime(),
        ),
      }))
      .sort((a, b) => GROUP_META[a.key].order - GROUP_META[b.key].order);
  }, [filteredConvs, filteredThreads]);

  // Agents offered by the "+ New" picker: the super-agent (always available,
  // listed first) followed by this project's own agents. Not affected by the
  // sidebar filter — you can always start a fresh chat with any of them.
  const newChatAgents = useMemo(
    () => [
      { slug: superAgentSlug, label: superAgentLabel },
      ...agents.map((a) => ({ slug: a.slug, label: a.slug })),
    ],
    [agents, superAgentSlug, superAgentLabel],
  );

  const agentOptions = useMemo(
    () => [
      { value: "", label: t("project.chat.list.all_agents") },
      { value: superAgentSlug, label: superAgentLabel },
      ...agents.map((a) => ({ value: a.slug, label: a.slug })),
    ],
    [agents, superAgentSlug, superAgentLabel],
  );

  // Conversations carry a slug, not an agent record — resolve it once here so
  // every row can wear the right face.
  const faceFor = (slug: string): AgentFace => {
    if (slug === superAgentSlug) return { slug, icon: superAgentIcon, name: superAgentLabel };
    const hit = agents.find((a) => a.slug === slug);
    return { slug, icon: hit?.icon, emoji: hit?.emoji, name: hit?.name || slug };
  };

  const totalCount = allConvs.length + (threadsQ.data?.length || 0);
  const anyLoaded =
    Object.keys(byAgent).length > 0 || agents.length === 0 || !!threadsQ.data;

  // Landing here with nothing chosen — a first visit, or a project switch that
  // left the previous chat's ids behind in the old URL — should open THIS
  // project's most recent conversation, not a blank session belonging to
  // nothing. Waits for every list to answer, so a slow agent fetch can't make
  // a channel thread look like the newest thing in the project. Fires once:
  // after that the selection is the user's, and re-picking would fight them.
  const autoSelected = useRef(false);
  const listsReady =
    agents.every((a) => byAgent[a.slug] !== undefined) && !threadsQ.isLoading;
  useEffect(() => {
    if (!autoSelectLatest || autoSelected.current || !listsReady) return;
    autoSelected.current = true;
    const newest = [
      ...allConvs.map((c) => ({
        ts: c.started_at || "",
        key: { kind: "conv", agentSlug: c.agent_slug, convId: c.id } as ChatKey,
        meta: { channel: c.channel, createdAt: c.started_at, title: c.title },
      })),
      ...(threadsQ.data || []).map((th) => ({
        ts: th.last_ts || th.started_at || "",
        key: { kind: "thread", channel: th.channel, threadId: th.id } as ChatKey,
        meta: { channel: th.channel, createdAt: th.started_at, title: th.title },
      })),
    ].sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime())[0];
    // A project with no conversations yet keeps the live session already shown.
    if (newest) onSelect(newest.key, newest.meta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectLatest, listsReady, allConvs, threadsQ.data]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card/30">
      {/* Hidden per-agent fetchers — one SWR per agent, but with a stable
          component per slug so rules-of-hooks are respected. */}
      {agents.map((a) => (
        <AgentConvFetcher key={a.slug} pid={pid} slug={a.slug} onLoaded={handleLoaded} />
      ))}

      <header className="flex h-[57px] shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t("project.chat.list.title")}</p>
          <p className="text-[10px] text-muted-fg">
            {t("project.chat.list.count", { n: totalCount })}
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => (pickerOpen ? closePicker() : openPicker())}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/60 px-2 py-1 text-[11px] font-medium hover:bg-accent"
          >
            <Plus className="size-3" /> {t("project.chat.list.new")}
          </button>
          {pickerOpen && (
            <>
              {/* Click-away layer. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={closePicker}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-60 rounded-md border border-border bg-card p-1 shadow-lg">
                {pickerMode === "root" ? (
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setPickerMode("agent")}
                      className="flex items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent/50"
                    >
                      <MessageSquare className="size-4 shrink-0 text-muted-fg" />
                      <span>
                        <span className="block font-medium">{t("project.chat.list.new_single")}</span>
                        <span className="block text-[10px] text-muted-fg">{t("project.chat.list.new_single_hint")}</span>
                      </span>
                    </button>
                    {onNewGroup && agents.length >= 2 && (
                      <button
                        type="button"
                        onClick={() => setPickerMode("group")}
                        className="flex items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent/50"
                      >
                        <Users className="size-4 shrink-0 text-primary" />
                        <span>
                          <span className="block font-medium">{t("project.groups.new_title")}</span>
                          <span className="block text-[10px] text-muted-fg">{t("project.groups.new_hint")}</span>
                        </span>
                      </button>
                    )}
                  </div>
                ) : pickerMode === "group" ? (
                  <>
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
                      {t("project.groups.pick_members")}
                    </p>
                    <div className="max-h-56 overflow-y-auto">
                      {agents.map((a) => {
                        const on = groupPick.includes(a.slug);
                        return (
                          <button
                            key={`grp-${a.slug}`}
                            type="button"
                            onClick={() => setGroupPick((p) => on ? p.filter((s) => s !== a.slug) : [...p, a.slug])}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                          >
                            <span className={clsx("flex size-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold",
                              on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                              {on ? groupPick.indexOf(a.slug) + 1 : ""}
                            </span>
                            <AgentAvatar icon={a.icon} emoji={a.emoji} name={a.name || a.slug} size={18} />
                            <span className="truncate">{a.name || a.slug}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="px-2 pt-1 text-[10px] text-muted-fg">{t("project.groups.first_hint")}</p>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <Switch
                        checked={groupShowTools}
                        onChange={setGroupShowTools}
                        label={t("chat_ui.show_tools")}
                      />
                    </div>
                    <p className="px-2 pb-1 text-[10px] text-muted-fg">{t("chat_ui.show_tools_hint")}</p>
                    <div className="flex items-center gap-1 p-1">
                      <button type="button" onClick={() => { setPickerMode("root"); setGroupPick([]); setGroupShowTools(false); }}
                        className="flex-1 rounded px-2 py-1 text-xs text-muted-fg hover:bg-accent/50">
                        {t("mobile.back")}
                      </button>
                      <button type="button" disabled={groupPick.length < 1}
                        onClick={() => {
                          const picks = groupPick;
                          const showTools = groupShowTools;
                          closePicker();
                          onNewGroup?.(picks, { showTools });
                        }}
                        className="flex-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
                        {t("project.groups.create")}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">
                      {t("project.chat.list.pick_agent")}
                    </p>
                    <div className="max-h-56 overflow-y-auto">
                      {newChatAgents.map((a) => (
                        <button
                          key={`new-${a.slug}`}
                          type="button"
                          onClick={() => { closePicker(); onNewChat(a.slug); }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                        >
                          <Bot className="size-3 shrink-0 text-muted-fg" />
                          <span className="truncate">{a.label}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="space-y-2 border-b border-border p-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("project.chat.list.search")}
        />
        <UiSelect value={agentFilter} onChange={setAgentFilter} options={agentOptions} />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {!anyLoaded && (
          <div className="px-2 py-1">
            <Loading />
          </div>
        )}

        {/* Stored conversations + super-agent channel threads, grouped by channel. */}
        {groups.map((g) => (
          <ChannelGroup
            key={g.key}
            keyName={g.key}
            count={g.items.length}
            collapsed={!!collapsed[g.key]}
            onToggle={() => setCollapsed((p) => ({ ...p, [g.key]: !p[g.key] }))}
          >
            {g.items.map((item) => {
              if (item.type === "thread") {
                const th = item.thread;
                const active =
                  selected.kind === "thread" &&
                  selected.channel === th.channel &&
                  selected.threadId === th.id;
                // Multi-agent threads (a2a between two agents, or a group room)
                // aren't the super-agent's: draw every participant's face and
                // skip the super-agent badge.
                const isMulti = th.channel === "a2a" || th.channel === "group";
                const parts = (th as unknown as { participants?: string[] }).participants;
                return (
                  <ChatListItem
                    key={`thread-${th.channel}-${th.id}`}
                    title={th.title}
                    subtitle={[th.channel, `${th.messages} msg`].join(" · ")}
                    badge={isMulti ? undefined : t("agents_ui.super_agent_badge")}
                    face={isMulti ? undefined : { icon: superAgentIcon, name: superAgentLabel }}
                    faces={isMulti && parts?.length ? parts.map(faceFor) : undefined}
                    timeAgo={th.last_ts}
                    selected={active}
                    onClick={() =>
                      onSelect(
                        { kind: "thread", channel: th.channel, threadId: th.id },
                        { channel: th.channel, createdAt: th.started_at, title: th.title },
                      )
                    }
                  />
                );
              }
              const c = item.conv;
              const active =
                selected.kind === "conv" &&
                selected.agentSlug === c.agent_slug &&
                selected.convId === c.id;
              return (
                <ChatListItem
                  key={`${c.agent_slug}-${c.id}`}
                  title={c.title || c.id}
                  subtitle={[c.agent_slug, `${c.messages ?? 0} msg`]
                    .filter(Boolean)
                    .join(" · ")}
                  face={faceFor(c.agent_slug)}
                  timeAgo={c.started_at}
                  selected={active}
                  onClick={() =>
                    onSelect(
                      { kind: "conv", agentSlug: c.agent_slug, convId: c.id },
                      { channel: c.channel, createdAt: c.started_at, title: c.title },
                    )
                  }
                />
              );
            })}
          </ChannelGroup>
        ))}

        {anyLoaded && allConvs.length === 0 && filteredThreads.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-fg">
            {t("project.chat.list.empty")}
          </p>
        )}
      </div>
    </aside>
  );
}

function ChannelGroup({
  keyName,
  count,
  collapsed,
  onToggle,
  children,
}: {
  keyName: ChannelGroupKey;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const meta = GROUP_META[keyName];
  const Icon = meta.icon;
  return (
    <section className="space-y-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-muted-fg hover:bg-accent/30"
      >
        <span className="inline-flex items-center gap-1.5">
          {collapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
          <Icon className="size-3" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {meta.label}
          </span>
        </span>
        <span className="text-[10px]">{count}</span>
      </button>
      {!collapsed && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}

function ChatListItem({
  title,
  subtitle,
  badge,
  face,
  faces,
  timeAgo,
  selected,
  onClick,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  /** Whose conversation this is — same face the thread header and the bubbles
   *  draw, so a row and the thread it opens look like the same agent. */
  face?: AgentFace;
  /** Two faces for a group chat (a2a): drawn overlapping. Wins over `face`. */
  faces?: AgentFace[];
  timeAgo?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/12"
          : "border-transparent hover:border-border hover:bg-accent/50",
      )}
    >
      {faces?.length ? (
        <AgentAvatarGroup faces={faces} size={22} className="mt-0.5" />
      ) : face ? (
        <AgentAvatar {...face} size={24} className="mt-0.5" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={clsx("truncate text-sm", selected ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          {timeAgo && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-fg">
              <Clock className="size-2.5" />
              {formatTimeAgo(timeAgo)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-fg">
          <span className="truncate">{subtitle}</span>
          {badge && <span className="shrink-0 truncate rounded bg-accent px-1.5 py-0.5">{badge}</span>}
        </span>
      </span>
    </button>
  );
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
