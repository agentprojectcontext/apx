import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, ConversationRow, IconButton, Icons, Menu, Spinner } from "@apx/ui";
import { Suspense } from "react";
import { AnswererFace } from "../channels/AnswererFace.tsx";
import { accountName } from "../channels/accountName.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { useChannels } from "../data/channels.ts";
import { DEFAULT_PID, isWorking, projectName, routineName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";
import { AccountLine } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { useRowFold } from "./RowFold.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  /** Listed in one channel account's own list: what was written last, and who they are and who answers them. */
  account?: boolean;
  /** Listed under its channel account's row, which already names the account. */
  bundled?: boolean;
  onOpen: () => void;
};

/**
 * A chat in a list, two lines: its title (with the chevron of its nested sessions) and when; then who speaks in it,
 * where, and its project (outside the project). Resting on it shows pin and archive; the rest is in its menu.
 */
export function ThreadRow({ thread, agent, selected, account = false, bundled = false, onOpen }: ThreadRowProps) {
  const t = useT();
  const channel = useThreadChannel(thread);
  const channelAccount = useChannels((s) =>
    thread.channel ? s.channels.find((c) => c.id === thread.channel?.id) : undefined,
  );
  const engine = useEngineLabel(thread.engine);
  const projects = useData((s) => s.projects);
  const inProject = useNav((s) => s.view === "project");
  const fold = useRowFold();
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  // A group's line names its members; its own name is the row's title.
  const members = useData((s) =>
    thread.kind === "group"
      ? thread.agent_ids
          .map((id) => s.agents[id]?.name)
          .filter(Boolean)
          .join(", ")
      : undefined,
  );
  const who = members || (engine ?? agent?.name ?? thread.title);
  const own = account && Boolean(thread.channel);
  return (
    <div className="threadrow-wrap" ref={fold.wrap}>
      <ContextMenu items={threadMenu(thread, { t, agent })}>
        <ConversationRow
          className={`threadrow${own ? " threadrow--account" : ""}${own && channel === "email" ? " threadrow--mail" : ""}`}
          selected={selected}
          onClick={onOpen}
          avatar={<ThreadAvatar thread={thread} agent={agent} size={own ? 32 : 22} slot={own ? 36 : 28} />}
          title={thread.kind === "routine" ? routineName(thread) : thread.title}
          titleTag={
            <>
              {fold.slot}
              <ChatProcesses thread={thread.id} />
              {working && <Spinner size={12} className="threadrow__spin" />}
              {/* An account's list puts every mark at the end of the line under it. */}
              {!own && <ContactMarks person={thread.channel?.person_id} />}
            </>
          }
          time={shortWhen(thread.updated_at)}
          unread={thread.unread}
          {...(own
            ? {
                meta: (
                  <Suspense fallback={null}>
                    <AccountLine thread={thread} agent={agent} />
                  </Suspense>
                ),
              }
            : {})}
          preview={
            own ? (
              <Said thread={thread} mail={channel === "email"} />
            ) : (
              <span className="threadrow__line">
                {/* A channel chat's own face is the person's or the room's: the agent who answers it shows here. */}
                {thread.channel && !engine && <AnswererFace agent={agent} />}
                <span className="threadrow__who">
                  {waiting && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
                  {/* A channel chat's badge names its account, so the line does not say the app again. */}
                  {[who, channel ? undefined : contextOf(thread, agent, t)].filter(Boolean).join(" · ")}
                </span>
                {/* Under its account's row the account is already said; elsewhere its badge names it. */}
                {channelAccount && !bundled && (
                  <>
                    <span className="threadrow__dot">·</span>
                    <ProjectBadge id={channelAccount.id} name={accountName(channelAccount, t)} channel={channel} />
                  </>
                )}
                {/* A chat with no project (the super-agent's) is the base project's: its badge says so. A channel
                    chat says its project only when it has one of its own. */}
                {!inProject && (!thread.channel || (thread.project_id && thread.project_id !== DEFAULT_PID)) && (
                  <>
                    <span className="threadrow__dot">·</span>
                    <ProjectBadge
                      id={thread.project_id ?? DEFAULT_PID}
                      name={projectName(projects, thread.project_id)}
                      channel={thread.channel ? undefined : channel}
                    />
                  </>
                )}
              </span>
            )
          }
        />
      </ContextMenu>
      {fold.button}
      {/* Pointed at, "···" takes the time's place: the row's whole menu, the fold beside the title left free. */}
      <span className="threadrow__more">
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={threadMenu(thread, { t, agent })}
        />
      </span>
    </div>
  );
}

/**
 * What was written last, as the account's list shows it: one line with "…" for a chat; for a mail, its subject and
 * two lines of it (the core keeps a mail's preview as "Subject · text").
 */
function Said({ thread, mail }: { thread: Thread; mail: boolean }) {
  const text = thread.preview.replace(/\s+/g, " ").trim();
  const cut = mail ? text.indexOf(" · ") : -1;
  if (cut < 0) return <span className="threadrow__said">{text}</span>;
  return (
    <>
      <span className="threadrow__subject">{text.slice(0, cut)}</span>
      <span className="threadrow__said">{text.slice(cut + 3)}</span>
    </>
  );
}

/** A contact's chat says when they are silenced or supervised, beside its title. */
function ContactMarks({ person }: { person: string | undefined }) {
  const t = useT();
  const muted = useChannels((s) => Boolean(person && s.persons.find((p) => p.id === person)?.muted));
  const supervised = useChannels((s) => Boolean(person && s.persons.find((p) => p.id === person)?.supervised));
  if (!muted && !supervised) return null;
  return (
    <>
      {muted && (
        <span className="threadrow__mark" role="img" aria-label={t("ch.muted")}>
          <Icons.BellOff size={11} />
        </span>
      )}
      {supervised && (
        <span className="threadrow__mark" role="img" aria-label={t("ch.supervised")}>
          <Icons.Eye size={11} />
        </span>
      )}
    </>
  );
}

/** The mark of a chat the owner pinned on top of its group. */
export function PinMark() {
  const t = useT();
  return (
    <span className="threadrow__pin" role="img" aria-label={t("thread.pinned")}>
      <Icons.Pin size={11} />
    </span>
  );
}

/**
 * Where the chat happens, after who speaks in it: the channel's app for a contact's chat, "External session" for an
 * engine's, nothing for a group (its line names its members), and otherwise the agent's role (or what kind of chat it is).
 */
function contextOf(thread: Thread, agent: Agent | undefined, t: T): string {
  if (thread.engine) return t("nav.externalSession");
  if (thread.kind === "group") return "";
  if (thread.kind === "a2a") return t("thread.a2a");
  if (thread.kind === "routine") return t("thread.routineOf", { name: routineName(thread) });
  if (thread.flow) return t("thread.flowStep");
  return agent?.role || (thread.kind === "home" ? t("thread.home") : t("thread.chat"));
}
