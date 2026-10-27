import type { Agent } from "@apx/protocol";
import { ContextMenu, Icons, ProjectTile, Spinner } from "@apx/ui";
import { Suspense } from "react";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { DEFAULT_PID, isWorking, projectName, projectTone } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { TaskBundle } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { type ActivityGroup, bundleTasks, type TimeBucket } from "./groupThreads.ts";
import { CodeMark, chatLabel, RoutineMark, Where } from "./InboxViews.tsx";
import { RoutineBundle } from "./RoutineBundle.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { PinMark } from "./ThreadRow.tsx";
import { threadMenu } from "./threadActions.tsx";

const BUCKET: Record<TimeBucket, MessageKey> = {
  pinned: "inbox.when.pinned",
  running: "inbox.when.running",
  today: "inbox.when.today",
  yesterday: "inbox.when.yesterday",
  week: "inbox.when.week",
  earlier: "inbox.when.earlier",
};

/** Activity: chats by time, with what runs now on top; project and agent as each row's context. */
export function ActivityView({ groups, selected }: { groups: ActivityGroup[]; selected: string | undefined }) {
  const t = useT();
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  return (
    <>
      {groups.map((g) => (
        <div key={g.bucket} className="activity__group">
          <div className="activity__label">{t(BUCKET[g.bucket])}</div>
          {bundleTasks(g.threads).map((entry) => {
            if (entry.kind === "routine")
              return (
                <RoutineBundle
                  key={`routine:${entry.routineId}`}
                  routineId={entry.routineId}
                  threads={entry.threads}
                  selected={selected}
                />
              );
            if (entry.kind === "task")
              return (
                <Suspense key={entry.taskId} fallback={null}>
                  <TaskBundle taskId={entry.taskId} threads={entry.threads} selected={selected} />
                </Suspense>
              );
            const th = entry.thread;
            const agent: Agent | undefined = agents[th.agent_ids[0] ?? ""];
            return (
              <ListedChat key={th.id} thread={th} selected={selected}>
                <ContextMenu items={threadMenu(th, { t, agent })}>
                  <button
                    type="button"
                    className={["activity__row", th.id === selected && "is-selected", th.unread > 0 && "is-unread"]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => go.thread(th.id)}
                  >
                    <ThreadAvatar thread={th} agent={agent} size={24} slot={28} />
                    <span className="activity__body">
                      <span className="activity__title">
                        {isWorking(th.state) && <Spinner size={12} />}
                        {th.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
                        {th.pinned && <PinMark />}
                        <RoutineMark thread={th} />
                        <span className="activity__text">{chatLabel(th, agent, t("chat.new"))}</span>
                        <ChatProcesses thread={th.id} />
                      </span>
                      <span className="activity__meta">
                        <ProjectTile tone={projectTone(th.project_id ?? DEFAULT_PID)} size={10} />
                        {projectName(projects, th.project_id)} · <Where thread={th} agent={agent} />
                        <CodeMark thread={th} />
                      </span>
                    </span>
                    <span className="activity__side">
                      <span className="tree__when">{shortWhen(th.updated_at)}</span>
                      {th.unread > 0 && <span className="tree__unread">{th.unread}</span>}
                    </span>
                  </button>
                </ContextMenu>
              </ListedChat>
            );
          })}
        </div>
      ))}
    </>
  );
}
