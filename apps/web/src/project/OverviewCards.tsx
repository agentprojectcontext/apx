// The overview's side cards: what waits for the owner, the latest chats and the agents, each with a way to its tab.
import type { Thread } from "@apx/protocol";
import { AgentAvatar, Icons, Spinner, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, DEFAULT_PID, isWorking, type ProjectEntry, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ThreadAvatar } from "../inbox/ThreadAvatar.tsx";
import { go } from "../shell/nav.ts";
import type { Waiting } from "./overviewData.ts";
import { useProjectMembers } from "./ProjectSide.tsx";

/** A side card: a title, an optional link to the whole list, and its rows. */
export function OverviewCard({
  title,
  link,
  mark,
  children,
}: {
  title: string;
  link?: { label: string; onClick: () => void } | undefined;
  /** A dot before the title when something needs the owner. */
  mark?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="projside__block" aria-label={title}>
      <h2 className="projside__h">
        {mark && <span className="projside__mark" aria-hidden />}
        <span className="projside__htext">{title}</span>
        {link && (
          // ui: a quiet text link in the card's header, as the owner's sketch draws it.
          <button type="button" className="overview__link" onClick={link.onClick}>
            {link.label}
          </button>
        )}
      </h2>
      {children}
    </section>
  );
}

export function WaitingCard({ waiting, pid }: { waiting: Waiting; pid: string }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const count = waiting.tasks.length + waiting.chats.length;
  return (
    <OverviewCard
      title={t("overview.waiting")}
      mark={count > 0}
      link={{ label: t("overview.seeTasks"), onClick: () => go.projectTab("tasks") }}
    >
      {count === 0 ? (
        <p className="projside__hint">{t("overview.nothingWaiting")}</p>
      ) : (
        <div className="projside__rows">
          {waiting.chats.map((th) => (
            // ui: a chat row (face, title, why it waits), as the latest chats below.
            <button key={th.id} type="button" className="projside__row" onClick={() => go.project(pid, "chats", th.id)}>
              <ThreadAvatar thread={th} agent={threadAgent(th, agents)} size={24} animated={false} />
              <span className="projside__rowtext">
                <span className="projside__rowname">{th.title}</span>
                <span className="projside__rowsub">{t("running.waitingForYou")}</span>
              </span>
            </button>
          ))}
          {waiting.tasks.slice(0, 5).map((task) => (
            // ui: a task row in the same list.
            <button key={task.id} type="button" className="projside__row" onClick={() => go.task(task.id)}>
              <span className="projside__rowicon">
                <Icons.ListChecks size={14} />
              </span>
              <span className="projside__rowtext">
                <span className="projside__rowname">{task.title}</span>
                <span className="projside__rowsub">{t("overview.taskWaits")}</span>
              </span>
              <span className="projside__rowwhen">{shortWhen(task.activity_at)}</span>
            </button>
          ))}
        </div>
      )}
    </OverviewCard>
  );
}

export function RecentChatsCard({ chats, pid }: { chats: Thread[]; pid: string }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  return (
    <OverviewCard
      title={t("overview.recent")}
      link={chats.length ? { label: t("overview.seeChats"), onClick: () => go.projectTab("chats") } : undefined}
    >
      {chats.length ? (
        <div className="projside__rows">
          {chats.slice(0, 5).map((th) => (
            // ui: a chat row (face, title, its last line, when), as the owner's sketch draws it.
            <button key={th.id} type="button" className="projside__row" onClick={() => go.project(pid, "chats", th.id)}>
              <ThreadAvatar thread={th} agent={threadAgent(th, agents)} size={24} animated={false} />
              <span className="projside__rowtext">
                <span className="projside__rowname">{th.title}</span>
                {firstLine(th.preview) && <span className="projside__rowsub">{firstLine(th.preview)}</span>}
              </span>
              {isWorking(th.state) ? (
                <Spinner size={12} />
              ) : th.unread > 0 ? (
                <span className="overview__unread">{th.unread}</span>
              ) : (
                <span className="projside__rowwhen">{shortWhen(th.updated_at)}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="projside__hint">{t("overview.noChats")}</p>
      )}
    </OverviewCard>
  );
}

export function AgentsCard({ project }: { project: ProjectEntry }) {
  const t = useT();
  const { members, parent } = useProjectMembers(project);
  const origin = (from: (typeof members)[number]["from"]) =>
    from === "own"
      ? t("projside.own")
      : from === "parent"
        ? t("overview.fromParent", { name: parent?.name ?? "" })
        : t("projside.everywhere");
  const open = (from: (typeof members)[number]["from"]) =>
    from === "own" ? go.projectTab("team") : go.project(from === "parent" && parent ? parent.id : DEFAULT_PID, "team");
  return (
    <OverviewCard
      title={t("overview.team")}
      link={{ label: t("overview.seeAll"), onClick: () => go.projectTab("team") }}
    >
      {members.length ? (
        <div className="overview__pills">
          {members.map((m) => (
            <Tooltip key={m.agent.id} content={`${m.agent.name} · ${origin(m.from)}`}>
              {/* ui: an agent chip (face and name), as the owner's sketch draws it. */}
              <button type="button" className="overview__pill" onClick={() => open(m.from)}>
                <AgentAvatar name={m.agent.name} blob={blobOf(m.agent)} size={20} animated={false} />
                <span className="overview__pillname">{m.agent.name}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      ) : (
        <p className="projside__hint">{t("overview.noAgents")}</p>
      )}
    </OverviewCard>
  );
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").replace(/\*\*|`/g, "");
}
