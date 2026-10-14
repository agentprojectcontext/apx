import type { Thread } from "@apx/protocol";
import { AgentAvatar, IconButton, Icons, Spinner } from "@apx/ui";
import { useState } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, isWorking } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SessionRow } from "./InboxViews.tsx";

const cx = (...c: Array<string | false>) => c.filter(Boolean).join(" ");

/**
 * Every chat the agents keep for one task, as one row of a list: the task, who works it and whether it runs; opened,
 * each agent's chat. The task's name opens the task itself.
 */
export function TaskBundle({ taskId, threads, selected }: { taskId: string; threads: Thread[]; selected?: string }) {
  const t = useT();
  const task = useTasks((s) => s.tasks[taskId]);
  const agents = useData((s) => s.agents);
  const [open, setOpen] = useState(() => threads.some((th) => th.id === selected));
  const running = threads.some((th) => isWorking(th.state));
  const waiting = threads.some((th) => th.state === "input-required");
  const unread = threads.reduce((n, th) => n + th.unread, 0);
  const who = [...new Set(threads.map((th) => th.agent_ids[0] ?? ""))].map((id) => agents[id]).filter(Boolean);
  const title = task?.title ?? threads[0]?.title ?? taskId;
  return (
    <div className="taskbundle">
      <div className={cx("taskbundle__head", unread > 0 && "is-unread")}>
        <IconButton
          size="sm"
          label={open ? t("inbox.taskBundle.close") : t("inbox.taskBundle.open")}
          icon={open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
          onClick={() => setOpen((v) => !v)}
        />
        <button type="button" className="taskbundle__task" onClick={() => go.task(taskId)}>
          <Icons.ListChecks size={14} className="taskbundle__icon" />
          {running && <Spinner size={12} />}
          {waiting && <Icons.Hand size={12} className="tree__waiting" />}
          <span className="taskbundle__title">{title}</span>
          <span className="taskbundle__faces" aria-hidden>
            {who.slice(0, 3).map((a) => (
              <AgentAvatar key={a?.id} name={a?.name ?? ""} blob={blobOf(a)} size={16} animated={false} />
            ))}
          </span>
          <span className="tree__agentmeta">{t("inbox.taskBundle.chats", { n: threads.length })}</span>
          {unread > 0 && <span className="tree__unread">{unread}</span>}
          <span className="tree__when">{shortWhen(threads[0]?.updated_at ?? "")}</span>
        </button>
      </div>
      {open && (
        <div className="tree__sessions">
          {threads.map((th) => (
            <SessionRow
              key={th.id}
              thread={th}
              agent={agents[th.agent_ids[0] ?? ""]}
              selected={th.id === selected}
              withAgent
            />
          ))}
        </div>
      )}
    </div>
  );
}
