import type { Key } from "../i18n/index.ts";
import type { IconName } from "../ui/Icon";
import type { Tone } from "../ui/tone.ts";
import type { Notice, Workspace } from "./useWorkspace";

/** What the card's main button does. */
export type InboxAction =
  | { kind: "approve"; input: string; scope?: "session" | "always" }
  | { kind: "open"; thread?: string }
  | { kind: "rerun"; routine: string }
  /** A delegated session a limit stopped: one more turn. */
  | { kind: "continue"; session: string }
  | { kind: "dismiss" };

/** One card in the inbox: something an agent or the office is waiting on the owner for. */
export type InboxItem = {
  id: string;
  label: Key;
  tone: Tone;
  context: string;
  at: string;
  title: string;
  body?: string;
  /** Words shown apart, quoted (a question's options, what a confirmation would do). */
  quote?: string;
  agentId?: string;
  icon?: IconName;
  primary: { label: Key; action: InboxAction };
  secondary: { label: Key; action: InboxAction };
  /** Approvals that last longer than once (this session, always for this agent), when the core offers them. */
  more?: Array<{ label: Key; action: InboxAction }>;
  /** The notice behind it, marked read when the owner acts on the card. */
  notice?: Notice;
};

type Data = Pick<Workspace, "notices" | "inputs" | "threads" | "projects" | "routines" | "tasks">;

/** Waiting inputs first (newest first), then unread notices; a notice about an input that no longer waits is gone. */
export function inboxItems(data: Data): InboxItem[] {
  const projectOf = (threadId?: string) => {
    const thread = data.threads.find((item) => item.id === threadId);
    const project = data.projects.find((item) => item.id === thread?.project_id);
    return { thread, name: project?.name };
  };
  const ctx = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" · ");
  const inputs = data.inputs
    .filter((input) => input.state === "pending")
    .map((input): InboxItem => {
      const { thread, name } = projectOf(input.thread_id);
      const notice = data.notices.find((item) => item.kind === "input" && item.ref === input.id);
      const confirm = input.kind === "confirm";
      const scopes = confirm ? (input.approval_scopes ?? []) : [];
      const more = [
        ...(scopes.includes("session")
          ? [
              {
                label: "approveSession" as const,
                action: { kind: "approve" as const, input: input.id, scope: "session" as const },
              },
            ]
          : []),
        ...(scopes.includes("always")
          ? [
              {
                label: "approveAlways" as const,
                action: { kind: "approve" as const, input: input.id, scope: "always" as const },
              },
            ]
          : []),
      ];
      return {
        id: `input:${input.id}`,
        label: confirm ? "inboxApproval" : "inboxQuestion",
        tone: confirm ? "violet" : "info",
        context: ctx(name, thread?.title),
        at: notice?.created_at ?? "",
        title: input.prompt,
        body: input.detail,
        quote: input.options?.length ? input.options.join(" · ") : undefined,
        agentId: input.agent_id,
        primary: confirm
          ? { label: more.length ? "approveOnce" : "approve", action: { kind: "approve", input: input.id } }
          : { label: "reply", action: { kind: "open", thread: input.thread_id } },
        secondary: { label: "view", action: { kind: "open", thread: input.thread_id } },
        ...(more.length ? { more } : {}),
        notice,
      };
    });
  const notices = data.notices
    .filter((notice) => !notice.read_at && notice.kind !== "input")
    .map((notice) => noticeItem(notice, data, projectOf, ctx));
  const byNewest = (a: InboxItem, b: InboxItem) => b.at.localeCompare(a.at);
  return [...inputs.sort(byNewest), ...notices.sort(byNewest)];
}

function noticeItem(
  notice: Notice,
  data: Data,
  projectOf: (threadId?: string) => { thread?: Workspace["threads"][number]; name?: string },
  ctx: (...parts: Array<string | undefined>) => string,
): InboxItem {
  const { thread, name } = projectOf(notice.thread_id);
  const open = { kind: "open", thread: notice.thread_id } as const;
  const base = {
    id: `notice:${notice.id}`,
    at: notice.created_at,
    title: notice.title,
    body: notice.body || undefined,
    agentId: thread?.agent_ids[0],
    notice,
  };
  if (notice.kind === "routine") {
    // The notice points at the run; the name only helps when that run is no longer the routine's last.
    const routine =
      data.routines.find((item) => item.last?.run_id === notice.ref) ??
      data.routines.find((item) => item.name === notice.title);
    const failed = notice.level === "error";
    return {
      ...base,
      label: failed ? "inboxFailed" : "inboxRoutine",
      tone: failed ? "danger" : "info",
      context: ctx(name),
      icon: "RefreshCw",
      agentId: undefined,
      primary:
        failed && routine
          ? { label: "runAgain", action: { kind: "rerun", routine: routine.id } }
          : { label: "view", action: open },
      secondary: failed && routine ? { label: "view", action: open } : { label: "done", action: { kind: "dismiss" } },
    };
  }
  if (notice.kind === "task" || notice.kind === "due") {
    const task = data.tasks.find((item) => item.id === notice.ref);
    const blocked = notice.kind === "task";
    return {
      ...base,
      label: blocked ? "inboxBlocked" : "inboxDue",
      tone: "warning",
      context: ctx(name, task?.title ?? thread?.title),
      agentId: task?.assignee ?? base.agentId,
      icon: blocked ? undefined : "Clock",
      primary: { label: blocked ? "reply" : "view", action: open },
      secondary: { label: "done", action: { kind: "dismiss" } },
    };
  }
  if (notice.kind === "run") {
    // A turn that ended while the owner was away: a session (Claude Code, Codex) shows its terminal, a chat its agent.
    const failed = notice.level === "error";
    const session = thread?.kind === "code";
    return {
      ...base,
      label: failed ? "inboxFailed" : "inboxFinished",
      tone: failed ? "danger" : "brand",
      context: ctx(name, thread?.title),
      icon: failed ? "TriangleAlert" : session ? "Terminal" : base.agentId ? undefined : "CircleCheck",
      primary: { label: notice.thread_id ? "view" : "done", action: notice.thread_id ? open : { kind: "dismiss" } },
      secondary: { label: "done", action: { kind: "dismiss" } },
    };
  }
  // A delegated session a limit stopped (its notice points at the session): Continue, with nothing to write.
  if (notice.kind === "agent" && notice.ref?.startsWith("th_") && notice.level === "warn")
    return {
      ...base,
      label: "inboxStopped",
      tone: "warning",
      context: ctx(name, thread?.title),
      primary: { label: "delegationContinue", action: { kind: "continue", session: notice.ref } },
      secondary: { label: "view", action: { kind: "open", thread: notice.ref } },
    };
  const channel = notice.kind === "channel";
  // A kind this app does not know yet still shows, as a plain notice.
  const known = channel || notice.kind === "agent";
  return {
    ...base,
    label: notice.level === "error" ? "inboxFailed" : channel ? "inboxMessage" : "inboxNotice",
    tone: notice.level === "error" ? "danger" : channel ? "brand" : notice.level === "warn" ? "warning" : "neutral",
    context: ctx(name, thread?.title),
    icon: channel ? "MessageCircle" : known && base.agentId ? undefined : "Bell",
    primary: { label: notice.thread_id ? "view" : "done", action: notice.thread_id ? open : { kind: "dismiss" } },
    secondary: { label: "done", action: { kind: "dismiss" } },
  };
}
