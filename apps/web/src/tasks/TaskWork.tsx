import type { Task, Thread } from "@apx/protocol";
import { AgentAvatar, Icons, Skeleton, Spinner } from "@apx/ui";
import { shortWhen } from "../common/format.ts";
import { blobOf, isWorking } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

/**
 * The chats a task was worked in, one per agent that took it, newest first: who, how it is going, and a way into
 * each (it opens in the inbox, where the work happens).
 */
export function TaskWork({ task, sessions }: { task: Task; sessions: Thread[] | undefined }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const live = useData((s) => s.threads);
  if (!sessions) return <Skeleton width={180} />;
  if (!sessions.length)
    return <span className="taskwork__none">{t(task.assignee ? "tasks.work.notYet" : "tasks.work.none")}</span>;
  return (
    <div className="taskwork">
      {[...sessions].reverse().map((s) => {
        const chat = live[s.id] ?? s;
        const agent = agents[s.agent_ids[0] ?? ""];
        const name = agent?.name ?? s.agent_ids[0] ?? "";
        return (
          <button
            key={s.id}
            type="button"
            className="taskwork__chat"
            title={t("tasks.work.open", { name })}
            onClick={() => go.thread(s.id)}
          >
            <AgentAvatar name={name} blob={blobOf(agent)} size={18} animated={false} />
            <span className="taskwork__name">{name}</span>
            <span className="taskwork__state">
              {isWorking(chat.state) ? (
                <>
                  <Spinner size={11} />
                  {t("tasks.work.working")}
                </>
              ) : (
                shortWhen(chat.updated_at)
              )}
            </span>
            <Icons.ChevronRight size={13} className="taskwork__go" />
          </button>
        );
      })}
    </div>
  );
}
