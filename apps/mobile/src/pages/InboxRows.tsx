import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { listWhen, textOrder } from "../format";
import { channelIdentity, chatPreview, chatTitle, isWorking, routineName, threadContext } from "../hooks/chatSelectors";
import { type InboxNode, nodeThreads } from "../hooks/inboxTree";
import type { Agent, Thread, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { EngineIcon } from "../ui/EngineIcon";
import { Icon } from "../ui/Icon";
import { AgentAvatar, AgentPair, CountBadge, IconButton, Spinner, useType } from "../ui/kit";
import { PersonAvatar } from "../ui/PersonAvatar";
import { makeStyles, useTheme } from "../ui/theme";

const agentOf = (id: string | undefined, agents: Agent[]) => agents.find((agent) => agent.id === id);
/** One face in the list: small enough that more chats fit, big enough to tell agents apart. */
export const LIST_FACE = 34;

export function inboxTitle(node: InboxNode, data: Workspace): string {
  if (node.kind === "routine") return data.routines.find((r) => r.id === node.ref)?.name ?? routineName(node.thread);
  if (node.kind === "task") return data.tasks.find((task) => task.id === node.ref)?.title ?? node.thread.title;
  return chatTitle(node.thread);
}

/** The size a pair of faces takes in the list: a little more than one face. */
export const PAIR_SIZE = 42;

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
  searching = false,
  caller,
}: {
  node: InboxNode;
  data: Workspace;
  open: (thread: Thread) => void;
  /** A long press: the chat's own actions (read, archive, delete…). */
  menu?: (thread: Thread) => void;
  searching?: boolean;
  caller?: string | undefined;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [expanded, setExpanded] = useState(false);
  const shown = searching || expanded;
  const title = inboxTitle(node, data);
  const threads = nodeThreads(node);
  const unread = threads.reduce((n, thread) => n + thread.unread, 0);
  const busy = threads.some((thread) => isWorking(thread.state));
  const waiting = threads.some((thread) => thread.state === "input-required");
  const failed = threads.some((thread) => thread.state === "failed");
  const latest = [...threads].sort((a, b) => textOrder(b.updated_at, a.updated_at))[0] ?? node.thread;
  const bundle = node.kind !== "thread";
  const ids = [...new Set(threads.flatMap((thread) => thread.agent_ids))];
  const [a, b] = ids.map((id) => agentOf(id, data.agents) ?? { id, name: id });
  const toggle = () => setExpanded((value) => !value);
  const preview = bundle
    ? node.kind === "routine"
      ? t("routineRuns", { n: node.children.length })
      : t("taskChats", { n: node.children.length })
    : chatPreview(node.thread) || t("noMessagesYet");
  return (
    <View>
      <View style={s.container}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={bundle ? { expanded: shown } : undefined}
          onPress={bundle ? toggle : () => open(node.thread)}
          onLongPress={menu && !bundle ? () => menu(node.thread) : undefined}
          delayLongPress={350}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
        >
          <View style={s.avatar}>
            {bundle && a && b ? (
              <AgentPair first={a} second={b} size={PAIR_SIZE} />
            ) : (
              <ThreadAvatar
                thread={node.thread}
                agents={data.agents}
                data={data}
                size={LIST_FACE}
                caller={data.threads.find((thread) => thread.id === node.thread.parent_id)?.agent_ids[0] ?? caller}
              />
            )}
          </View>
          <View style={s.copy}>
            <View style={s.line}>
              {bundle || node.thread.kind === "routine" ? (
                <Icon name={node.kind === "task" ? "ListChecks" : "Clock"} size={13} color={theme.fgSubtle} />
              ) : null}
              <Text numberOfLines={1} style={[s.title, unread > 0 && { fontWeight: "600" }]}>
                {title}
              </Text>
              {busy ? <Spinner size={12} /> : null}
              <Text style={[type.meta, waiting && { color: theme.warning }, failed && { color: theme.danger }]}>
                {busy
                  ? t("working")
                  : waiting
                    ? t("waitsForYou")
                    : failed
                      ? t("inboxFailed")
                      : listWhen(latest.updated_at)}
              </Text>
            </View>
            <View style={s.line}>
              <Text numberOfLines={1} style={[s.preview, unread > 0 && { color: theme.fg }]}>
                {preview}
              </Text>
              {unread > 0 ? <CountBadge count={unread} /> : null}
            </View>
            <Text numberOfLines={1} style={type.small}>
              {threadContext(node.thread, data)}
            </Text>
          </View>
          {bundle ? <Icon name={shown ? "ChevronDown" : "ChevronRight"} size={16} color={theme.fgSubtle} /> : null}
        </Pressable>
        {!bundle && node.children.length > 0 ? (
          <IconButton
            icon={shown ? "ChevronDown" : "ChevronRight"}
            label={t(shown ? "collapseSessions" : "expandSessions", { name: title })}
            onPress={toggle}
          />
        ) : null}
      </View>
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
            />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((theme) => ({
  container: { flexDirection: "row", alignItems: "center" },
  row: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, paddingHorizontal: 16 },
  avatar: { width: PAIR_SIZE, height: PAIR_SIZE, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: theme.fg, fontSize: 15, fontWeight: "500" },
  preview: { flex: 1, color: theme.fgMuted, fontSize: 13 },
  nested: { marginLeft: 20, borderLeftWidth: 1, borderLeftColor: theme.border },
}));
