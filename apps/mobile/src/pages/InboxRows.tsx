import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { listWhen } from "../format";
import { channelIdentity, chatPreview, chatTitle, isWorking, routineName } from "../hooks/chatSelectors";
import { type InboxNode, nodeThreads } from "../hooks/inboxTree";
import type { Agent, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { scheduleText } from "../routines/view";
import { EngineIcon } from "../ui/EngineIcon";
import { Icon } from "../ui/Icon";
import { AgentAvatar, AgentPair, CountBadge, Spinner, useType } from "../ui/kit";
import { PersonAvatar } from "../ui/PersonAvatar";
import { makeStyles, useTheme } from "../ui/theme";

const agentOf = (id: string | undefined, agents: Agent[]) => agents.find((agent) => agent.id === id);
/** One face in the list: small enough that more chats fit, big enough to tell agents apart. */
export const LIST_FACE = 30;
/** A face under another row. */
const NESTED_FACE = 24;

export function inboxTitle(node: InboxNode, data: Workspace): string {
  if (node.kind === "routine") return data.routines.find((r) => r.id === node.ref)?.name ?? routineName(node.thread);
  if (node.kind === "task") return data.tasks.find((task) => task.id === node.ref)?.title ?? node.thread.title;
  return chatTitle(node.thread);
}

/** The size a pair of faces takes in the list: a little more than one face. */
export const PAIR_SIZE = 36;

/**
 * Delegations show the target first, and the caller second, including single-agent sessions. A contact's chat shows the
 * contact, with their app's mark, when `data` knows the channels.
 */
export function ThreadAvatar({
  thread,
  agents,
  size,
  caller,
  data,
}: {
  thread: Thread;
  agents: Agent[];
  size: number;
  caller?: string | undefined;
  data?: Pick<Workspace, "channels" | "persons">;
}) {
  if (thread.engine === "claude" || thread.engine === "codex") return <EngineIcon engine={thread.engine} size={size} />;
  const contact = data && channelIdentity(thread, data);
  if (contact) return <PersonAvatar person={contact.person} name={contact.name} size={size} channel={contact.type} />;
  const ids = thread.kind === "a2a" ? [thread.agent_ids[0], caller ?? thread.agent_ids[1]] : thread.agent_ids;
  const [a, b] = ids.map((id) => agentOf(id, agents) ?? (id ? { id, name: id } : undefined));
  if (a && b && (thread.kind !== "a2a" || a.id !== b.id)) {
    const pairSize = thread.kind === "a2a" ? size : size === LIST_FACE ? PAIR_SIZE : size + 4;
    const label =
      thread.kind === "a2a"
        ? t("delegationPair", { target: a.name, caller: b.name })
        : t("groupAgents", { first: a.name, second: b.name });
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={{ width: pairSize, height: pairSize }}
      >
        <AgentPair first={a} second={b} size={pairSize} />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a?.name ?? thread.title}
      style={{ width: size, height: size }}
    >
      <AgentAvatar name={a?.name ?? thread.title} blob={a?.blob} id={a?.id} size={size} />
    </View>
  );
}

/** Memoized: a list re-render (a sheet opening, another chat changing) leaves the rows that did not change alone. */
export const InboxRow = memo(function InboxRow({
  node,
  data,
  open,
  menu,
  taskMenu,
  searching = false,
  caller,
  nested = false,
  label,
}: {
  node: InboxNode;
  data: Workspace;
  /** Opens a chat; a task's or a routine's row opens its latest one. */
  open: (thread: Thread) => void;
  /** A long press: the chat's own actions (read, archive, delete…). */
  menu?: (thread: Thread) => void;
  /** A long press on a task's row: the task's options instead of its latest chat's. */
  taskMenu?: (taskId: string) => void;
  searching?: boolean;
  caller?: string | undefined;
  /** Under another row: a smaller face, the same two lines. */
  nested?: boolean;
  /** Under a task's row every chat has the task's title: who works in it tells them apart. */
  label?: string | undefined;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [expanded, setExpanded] = useState(false);
  // A routine is one row: its past runs are picked inside its chat, not listed here.
  const folds = node.kind !== "routine" && node.children.length > 0;
  const shown = folds && (searching || expanded);
  const title = label ?? inboxTitle(node, data);
  const threads = nodeThreads(node);
  const unread = threads.reduce((n, thread) => n + thread.unread, 0);
  const busy = threads.some((thread) => isWorking(thread.state));
  const waiting = threads.some((thread) => thread.state === "input-required");
  // A routine says how its latest run ended; a chat or task, whether any of its chats failed.
  const failed =
    node.kind === "routine" ? node.thread.state === "failed" : threads.some((thread) => thread.state === "failed");
  const toggle = () => setExpanded((value) => !value);
  // How many chats the task has, or runs the routine has: not the sessions under them.
  const members = [node, ...node.children].filter((item) =>
    node.kind === "routine" ? item.thread.kind === "routine" : sameTask(item.thread),
  ).length;
  const routine = node.kind === "routine" ? data.routines.find((r) => r.id === node.ref) : undefined;
  const preview = chatPreview(node.thread) || t("noMessagesYet");
  const face = nested ? NESTED_FACE : LIST_FACE;
  const longPress =
    node.kind === "task" && taskMenu ? () => taskMenu(node.ref) : menu ? () => menu(node.thread) : undefined;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={() => open(node.thread)}
        onLongPress={longPress}
        delayLongPress={350}
        style={({ pressed }) => [s.row, nested && s.nestedRow, pressed && { backgroundColor: theme.fill }]}
      >
        <View style={[s.avatar, { width: face, height: face }]}>
          <ThreadAvatar
            thread={node.thread}
            agents={data.agents}
            data={data}
            size={face}
            caller={data.threads.find((thread) => thread.id === node.thread.parent_id)?.agent_ids[0] ?? caller}
          />
        </View>
        <View style={s.copy}>
          <View style={s.line}>
            {node.kind !== "thread" || node.thread.kind === "routine" ? (
              <Icon name={node.kind === "task" ? "ListChecks" : "RefreshCw"} size={12} color={theme.fgSubtle} />
            ) : null}
            <Text numberOfLines={1} style={[s.title, nested && s.nestedTitle, unread > 0 && { fontWeight: "600" }]}>
              {title}
            </Text>
            {folds ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(shown ? "collapseSessions" : "expandSessions", { name: title })}
                accessibilityState={{ expanded: shown }}
                hitSlop={12}
                onPress={toggle}
                style={({ pressed }) => [s.fold, pressed && { backgroundColor: theme.fillHover }]}
              >
                <Icon name={shown ? "ChevronDown" : "ChevronRight"} size={13} color={theme.fgMuted} />
              </Pressable>
            ) : null}
            <View style={s.spacer} />
            {busy ? <Spinner size={11} /> : null}
            <Text style={[type.meta, waiting && { color: theme.warning }, failed && { color: theme.danger }]}>
              {busy
                ? t("working")
                : waiting
                  ? t("waitsForYou")
                  : failed
                    ? t("inboxFailed")
                    : listWhen(node.thread.updated_at)}
            </Text>
          </View>
          <View style={s.line}>
            {node.kind !== "thread" && members > 1 ? (
              <Count icon={node.kind === "task" ? "MessageCircle" : "RefreshCw"} n={members} />
            ) : null}
            <Text numberOfLines={1} style={[s.preview, unread > 0 && { color: theme.fg }]}>
              {routine ? scheduleText(routine.schedule) : preview}
            </Text>
            {unread > 0 ? <CountBadge count={unread} small /> : null}
          </View>
        </View>
      </Pressable>
      {shown ? (
        <View style={s.nested}>
          {node.children.map((child) => (
            <InboxRow
              key={child.key}
              node={child}
              data={data}
              open={open}
              {...(menu ? { menu } : {})}
              searching={searching}
              caller={node.thread.agent_ids[0]}
              label={
                node.kind === "task" && sameTask(child.thread)
                  ? agentOf(child.thread.agent_ids[0], data.agents)?.name
                  : undefined
              }
              nested
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** A chat kept for a task (the task's own or one an agent works it in), not a session one of them started. */
const sameTask = (thread: Thread) => Boolean(thread.task_id) || thread.kind === "task";

/** How many chats a task has, or runs a routine has, before the second line's words. */
function Count({ icon, n }: { icon: "MessageCircle" | "RefreshCw"; n: number }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.count}>
      <Icon name={icon} size={11} color={theme.fgSubtle} />
      <Text style={s.countText}>{n}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 16 },
  nestedRow: { paddingVertical: 5, paddingLeft: 12 },
  avatar: { alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, color: theme.fg, fontSize: 15, fontWeight: "500" },
  nestedTitle: { fontSize: 14 },
  spacer: { flex: 1, minWidth: 4 },
  fold: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  preview: { flex: 1, color: theme.fgMuted, fontSize: 13 },
  count: { flexDirection: "row", alignItems: "center", gap: 3 },
  countText: { color: theme.fgSubtle, fontSize: 12 },
  nested: { marginLeft: 30, borderLeftWidth: 1, borderLeftColor: theme.border },
}));
