import { useEffect, useMemo, useState, type ElementType } from "react";
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
  Sparkles,
  Timer,
  User,
} from "lucide-react";
import { Conversations } from "../../lib/api";
import { Input, Loading } from "../ui";
import { UiSelect } from "../UiSelect";
import { t } from "../../i18n";
import type { AgentEntry, ConversationListEntry, ThreadListEntry } from "../../types/daemon";

// Channel taxonomy — same channels the daemon writes ("web", "voice",
// "desktop", "telegram", …) folded into 8 sidebar groups. Each group has an
// icon + a fixed display order so the sidebar is stable across reloads.
export type ChannelGroupKey =
  | "live"
  | "telegram"
  | "voice"
  | "desktop"
  | "web"
  | "a2a"
  | "schedule"
  | "other";

interface GroupMeta {
  label: string;
  icon: ElementType;
  order: number;
}

const GROUP_META: Record<ChannelGroupKey, GroupMeta> = {
  live:     { label: "Live", icon: Sparkles, order: 0 },
  telegram: { label: "Telegram", icon: Send, order: 1 },
  voice:    { label: "Voice", icon: Mic, order: 2 },
  desktop:  { label: "Desktop", icon: Monitor, order: 3 },
  web:      { label: "Web", icon: MessageSquare, order: 4 },
  a2a:      { label: "Agent ↔ Agent", icon: Bot, order: 5 },
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

interface Props {
  pid: string;
  agents: AgentEntry[];
  /** Virtual super-agent slug used by the dropdown (kept in sync with ChatTab). */
  superAgentSlug: string;
  superAgentLabel: string;
  selected: ChatKey;
  onSelect: (key: ChatKey) => void;
  onNewChat: () => void;
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
    `/projects/${pid}/agents/${slug}/conversations`,
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
  selected,
  onSelect,
  onNewChat,
}: Props) {
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Partial<Record<ChannelGroupKey, boolean>>>({});
  const [byAgent, setByAgent] = useState<Record<string, ConversationListEntry[]>>({});

  // Super-agent channel threads (telegram, web quick-chat, desktop …) come from
  // the global message ledger, which is daemon-level and NOT project-scoped.
  // Only surface them in the Base workspace (pid "0"); inside a real project the
  // sidebar shows just that project's own agent conversations.
  const isBase = String(pid) === "0";
  const threadsQ = useSWR(
    isBase ? `/projects/${pid}/super-agent/threads` : null,
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

  // "Live" agents shown at the top: super-agent + project agents matching the
  // current agent filter (so "filter by foo" hides the others everywhere).
  const liveAgents = useMemo(() => {
    if (agentFilter === superAgentSlug) {
      return [{ slug: superAgentSlug, label: superAgentLabel }];
    }
    const out: { slug: string; label: string }[] = [];
    if (!agentFilter) out.push({ slug: superAgentSlug, label: superAgentLabel });
    for (const a of agents) {
      if (agentFilter && a.slug !== agentFilter) continue;
      out.push({ slug: a.slug, label: a.slug });
    }
    return out;
  }, [agents, agentFilter, superAgentSlug, superAgentLabel]);

  const agentOptions = useMemo(
    () => [
      { value: "", label: t("project.chat.list.all_agents") },
      { value: superAgentSlug, label: superAgentLabel },
      ...agents.map((a) => ({ value: a.slug, label: a.slug })),
    ],
    [agents, superAgentSlug, superAgentLabel],
  );

  const totalCount = allConvs.length + (threadsQ.data?.length || 0) + liveAgents.length;
  const anyLoaded =
    Object.keys(byAgent).length > 0 || agents.length === 0 || !!threadsQ.data;

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
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-accent/60 px-2 py-1 text-[11px] font-medium hover:bg-accent"
        >
          <Plus className="size-3" /> {t("project.chat.list.new")}
        </button>
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

        {/* Live group — synthetic, always first. */}
        {liveAgents.length > 0 && (
          <ChannelGroup
            keyName="live"
            count={liveAgents.length}
            collapsed={!!collapsed.live}
            onToggle={() => setCollapsed((p) => ({ ...p, live: !p.live }))}
          >
            {liveAgents.map((a) => {
              const isRoby = a.slug === superAgentSlug;
              const active =
                selected.kind === "live" && selected.agentSlug === a.slug;
              return (
                <ChatListItem
                  key={`live-${a.slug}`}
                  title={isRoby ? a.label : t("project.chat.list.live_with", { slug: a.slug })}
                  subtitle={t("project.chat.list.live_subtitle")}
                  badge={isRoby ? "super" : a.slug}
                  selected={active}
                  onClick={() => onSelect({ kind: "live", agentSlug: a.slug })}
                />
              );
            })}
          </ChannelGroup>
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
                return (
                  <ChatListItem
                    key={`thread-${th.channel}-${th.id}`}
                    title={th.title}
                    subtitle={[th.channel, `${th.messages} msg`].join(" · ")}
                    badge="super"
                    timeAgo={th.last_ts}
                    selected={active}
                    onClick={() =>
                      onSelect({ kind: "thread", channel: th.channel, threadId: th.id })
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
                  badge={c.agent_slug}
                  timeAgo={c.started_at}
                  selected={active}
                  onClick={() =>
                    onSelect({ kind: "conv", agentSlug: c.agent_slug, convId: c.id })
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
  timeAgo,
  selected,
  onClick,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  timeAgo?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-primary/50 bg-primary/10"
          : "border-transparent hover:border-border hover:bg-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={clsx("truncate text-sm", selected ? "font-semibold" : "font-medium")}>
          {title}
        </p>
        {timeAgo && (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-fg">
            <Clock className="size-2.5" />
            {formatTimeAgo(timeAgo)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-fg">
        <span className="truncate">{subtitle}</span>
        {badge && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/50 px-1.5 py-0.5">
            <User className="size-2.5" />
            {badge}
          </span>
        )}
      </div>
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
