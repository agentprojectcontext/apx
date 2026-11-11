import type { Notification } from "@apx/protocol";
import { AgentAvatar, Button, EngineIcon, Icons } from "@apx/ui";
import { useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { pairingChannel } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { blobOf, DEFAULT_PID, projectName, threadAgent } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { readNotifications, useAttention } from "../data/notifications.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";
import { noticeEvent, noticeTask } from "./noticeTarget.ts";

const KIND_ICON: Record<Notification["kind"], typeof Icons.Bell> = {
  input: Icons.Hand,
  task: Icons.ListChecks,
  due: Icons.Calendar,
  routine: Icons.Clock,
  channel: Icons.Send,
  agent: Icons.Bell,
  run: Icons.Activity,
  memory: Icons.Brain,
};

/** Opens what a notice is about. A question stays in the tray until it is answered. */
function openNotice(n: Notification): void {
  if (n.kind !== "input") void readNotifications([n.id]);
  const task = noticeTask(n);
  if (task) go.task(task);
  // A calendar reminder has nothing to open here: reading it is all.
  else if (noticeEvent(n)) return;
  else if (n.kind === "task" || n.kind === "due") go.view("tasks");
  else if (n.thread_id) go.inboxThread(n.thread_id);
  else if (n.kind === "channel" && n.ref?.startsWith("pairing:")) {
    // Someone waits to be let in: their row, lit, in the channel's own list — where it can be answered.
    go.channel(pairingChannel(n.ref.slice(8)) ?? "telegram", undefined);
    go.focus(n.ref);
  } else if (n.kind === "channel") go.view("channels");
  // What agents learned about the owner is confirmed in the base project's Memory tab, which opens on "About you".
  else if (n.kind === "memory") go.project(DEFAULT_PID, "memory");
}

/** The bell's list, loaded when it first opens: the newest notices, unread first. */
export function AttentionList({ onOpened }: { onOpened: () => void }) {
  const t = useT();
  const items = useAttention((s) => s.items);
  const unread = useAttention((s) => s.unread);
  const list = useMemo(
    () =>
      Object.values(items)
        .sort((a, b) => Number(!b.read_at) - Number(!a.read_at) || b.created_at.localeCompare(a.created_at))
        .slice(0, 30),
    [items],
  );
  return (
    <>
      <div className="attention__head">
        <span className="attention__title">{t("topbar.notifications")}</span>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void readNotifications()}>
            {t("attention.readAll")}
          </Button>
        )}
      </div>
      {list.length ? (
        <div className="running__list">
          {list.map((n) => (
            <NoticeRow
              key={n.id}
              notice={n}
              onOpen={() => {
                onOpened();
                openNotice(n);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="running__empty">{t("attention.empty")}</p>
      )}
    </>
  );
}

/** Stops reminders of a calendar event and the rest of its series; its notice leaves the tray. */
async function muteEvent(series: string, title: string, failed: (error: string) => string): Promise<void> {
  try {
    await client.call("integrations.mute_event", { series, title, muted: true });
  } catch (e) {
    notify(failed(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * A notice: who it comes from, what happened and when, the text in two lines, then who · project. A calendar
 * reminder can be told not to come again.
 */
function NoticeRow({ notice: n, onOpen }: { notice: Notification; onOpen: () => void }) {
  const t = useT();
  const series = noticeEvent(n);
  if (!series) return <NoticeButton notice={n} onOpen={onOpen} />;
  return (
    <div className="attention__item">
      <NoticeButton notice={n} onOpen={onOpen} />
      <div className="attention__actions">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void muteEvent(series, n.title, (error) => t("error.change", { error }))}
        >
          {t("attention.muteEvent")}
        </Button>
      </div>
    </div>
  );
}

function NoticeButton({ notice: n, onOpen }: { notice: Notification; onOpen: () => void }) {
  const t = useT();
  const thread = useData((s) => (n.thread_id ? s.threads[n.thread_id] : undefined));
  const agent = useData((s) => threadAgent(thread, s.agents));
  const projects = useData((s) => s.projects);
  const engine = useData((s) => (thread?.engine ? s.engines.find((e) => e.id === thread.engine) : undefined));
  const Icon = KIND_ICON[n.kind];
  const kind = t(`attention.kind.${n.kind}`);
  const who = agent?.name ?? (thread?.engine ? (engine?.label ?? thread.engine) : undefined);
  // A notice titled after its agent says what happened instead; the agent's name goes to the foot.
  const titled = n.title !== who;
  const meta = [titled ? kind : undefined, who, thread ? projectName(projects, thread.project_id) : undefined].filter(
    Boolean,
  );
  return (
    <button type="button" className={n.read_at ? "attention__row" : "attention__row is-unread"} onClick={onOpen}>
      {agent ? (
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={28} animated={false} />
      ) : thread?.engine ? (
        <EngineIcon engine={thread.engine} tile size={28} />
      ) : (
        <span className={`attention__icon is-${n.level}`}>
          <Icon size={14} />
        </span>
      )}
      <span className="attention__main">
        <span className="attention__top">
          <span className="attention__subject">{titled ? n.title : kind}</span>
          <span className="attention__time">{shortWhen(n.created_at)}</span>
        </span>
        {n.body && <span className="attention__body">{n.body}</span>}
        {meta.length > 0 && <span className="attention__meta">{meta.join(" · ")}</span>}
      </span>
    </button>
  );
}
