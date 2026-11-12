import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, Icons, Spinner, Tooltip } from "@apx/ui";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS } from "../channels/kinds.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { isWorking, routineName } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { PinMark } from "./ThreadRow.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

/**
 * A chat's name for a list: its title, or what was said last when the title only repeats the agent's name. A routine
 * run's is what it told (its routine shows by its mark).
 */
function chatLabel(thread: Thread, agent: Agent | undefined, generic: string): string {
  const plain = !thread.title || thread.title === agent?.name || thread.title === generic || thread.kind === "routine";
  const said = thread.preview.split("\n").find((l) => l.trim()) ?? "";
  return plain && said ? said.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") : thread.title;
}

const cx = (...c: Array<string | false>) => c.filter(Boolean).join(" ");

/**
 * A chat in a branch; `withAgent` names its agent first (a task's chats are several agents'), `label` replaces its
 * name, `onOpen` replaces opening it as the chat.
 */
export function SessionRow({
  thread,
  agent,
  selected,
  withAgent = false,
  label,
  onOpen,
}: {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  withAgent?: boolean;
  label?: string | undefined;
  onOpen?: (() => void) | undefined;
}) {
  const t = useT();
  const engine = useEngineLabel(thread.engine);
  const channel = useThreadChannel(thread);
  return (
    <ContextMenu items={threadMenu(thread, { t, agent })}>
      <button
        type="button"
        className={cx("tree__session", selected && "is-selected", thread.unread > 0 && "is-unread")}
        onClick={onOpen ?? (() => go.thread(thread.id))}
      >
        {isWorking(thread.state) && <Spinner size={12} />}
        {thread.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
        {thread.pinned && <PinMark />}
        <RoutineMark thread={thread} />
        {/* An engine session is the engine's (Claude Code, Codex), not the agent's that hosts it. */}
        <ThreadAvatar thread={thread} agent={agent} size={14} slot={16} />
        {withAgent && !thread.channel && (
          <span className="tree__sessionwho">{engine ?? agent?.name ?? thread.agent_ids[0]}</span>
        )}
        {/* Under its task, a chat's title only repeats the task's: what was said last tells them apart. */}
        <span className="tree__sessiontitle">
          {label ?? chatLabel(thread, agent, withAgent ? thread.title : t("chat.new"))}
        </span>
        {channel && (
          <span className="tree__agentmeta">
            <Where thread={thread} agent={agent} />
          </span>
        )}
        <CodeMark thread={thread} />
        <ChatProcesses thread={thread.id} />
        {thread.unread > 0 && <span className="tree__unread">{thread.unread}</span>}
        <span className="tree__when">{shortWhen(thread.updated_at)}</span>
      </button>
    </ContextMenu>
  );
}

/** A routine's run: a clock, and the routine's name on hover. */
function RoutineMark({ thread }: { thread: Thread }) {
  const t = useT();
  if (thread.kind !== "routine") return null;
  const name = routineName(thread);
  return (
    <Tooltip content={t("thread.routineHint", { name })}>
      <span className="tree__routine" role="img" aria-label={t("thread.routine")}>
        <Icons.Clock size={12} />
      </span>
    </Tooltip>
  );
}

/** Who a chat is with, for its context line: the channel it runs on, the engine, or the agent. */
function Where({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const engine = useEngineLabel(thread.engine);
  const via = useThreadChannel(thread);
  if (thread.kind === "routine") return <>{t("thread.routineOf", { name: routineName(thread) })}</>;
  if (via)
    return (
      <span className="activity__via">
        <KindIcon kind={via} size={10} /> {t("chat.viaChannel", { channel: t(CHANNEL_KINDS[via].name) })}
      </span>
    );
  return <>{engine ?? agent?.name ?? "—"}</>;
}

/** A coding session (the agent works inside a folder: reads, edits, runs): a folder mark that says where. */
function CodeMark({ thread }: { thread: Thread }) {
  const t = useT();
  if (thread.kind !== "code") return null;
  const folder = thread.cwd?.split("/").filter(Boolean).at(-1) ?? "";
  return (
    <Tooltip content={t("thread.codeHint", { folder })}>
      <span className="tree__code" role="img" aria-label={t("thread.code")}>
        <Icons.FolderCode size={12} />
      </span>
    </Tooltip>
  );
}
