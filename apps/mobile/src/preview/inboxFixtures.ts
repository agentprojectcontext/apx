import { emptyWorkspace, type Thread, type Workspace } from "../hooks/useWorkspace";

const thread = (id: string, title: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title,
  kind: "chat",
  agent_ids: ["agent_a"],
  state: "completed",
  preview: "Ready for review",
  unread: 0,
  updated_at: "2026-10-19T10:00:00Z",
  ...patch,
});

/** Local-only sample data, never sent to the core. */
export function inboxFixtures(): Workspace {
  return {
    ...emptyWorkspace,
    owner: "Acme",
    projects: [
      { id: "project_a", name: "Acme", registered: true },
      { id: "project_b", name: "Northwind", registered: true },
    ],
    agents: [
      { id: "agent_a", name: "Coordinator" },
      { id: "agent_b", name: "Researcher" },
      { id: "agent_c", name: "Reviewer" },
    ],
    routines: [
      {
        id: "routine_a",
        name: "Daily review",
        enabled: true,
        agent_id: "agent_a",
        schedule: { kind: "every", minutes: 1440 },
        action: "prompt",
        prompt: "Review updates",
        call_model: "always",
        anchor: false,
      },
      {
        id: "routine_b",
        name: "Daily review",
        enabled: true,
        agent_id: "agent_b",
        schedule: { kind: "every", minutes: 1440 },
        action: "prompt",
        prompt: "Review updates",
        call_model: "always",
        anchor: false,
      },
    ],
    tasks: [
      {
        id: "task_a",
        title: "Prepare launch",
        status: "doing",
        state: "open",
        kind: "task",
        priority: "normal",
        thread_id: "task_chat_a",
        awaits_owner: false,
        activity_at: "2026-10-19T09:00:00Z",
      },
    ],
    threads: [
      thread("home", "Launch planning", { unread: 3, pinned: true }),
      thread("session_a", "Research sources", { kind: "a2a", parent_id: "home", agent_ids: ["agent_b"], unread: 2 }),
      thread("session_b", "Verify sources", {
        kind: "a2a",
        parent_id: "session_a",
        agent_ids: ["agent_c"],
        state: "failed",
      }),
      thread("run_today", "Daily review · Today", {
        kind: "routine",
        routine_id: "routine_a",
        preview: "Latest summary. Review the launch notes.",
        unread: 1,
      }),
      thread("run_yesterday", "Daily review · Yesterday", {
        kind: "routine",
        routine_id: "routine_a",
        updated_at: "2026-10-18T10:00:00Z",
      }),
      thread("run_older", "Daily review · Earlier", {
        kind: "routine",
        routine_id: "routine_a",
        updated_at: "2026-10-16T10:00:00Z",
      }),
      thread("run_delegate", "Check metrics", { kind: "a2a", parent_id: "run_today", agent_ids: ["agent_b"] }),
      thread("run_distinct", "Daily review · Today", {
        kind: "routine",
        routine_id: "routine_b",
        agent_ids: ["agent_b"],
      }),
      thread("run_legacy", "Legacy routine · Today", { kind: "routine" }),
      thread("task_chat_a", "Draft proposal", { kind: "task", task_id: "task_a" }),
      thread("task_chat_b", "Review proposal", {
        kind: "task",
        task_id: "task_a",
        agent_ids: ["agent_c"],
        state: "input-required",
        unread: 1,
      }),
      thread("task_delegate", "Compare options", { kind: "a2a", parent_id: "task_chat_a", agent_ids: ["agent_b"] }),
      thread("group", "Launch team", { agent_ids: ["agent_a", "agent_b", "agent_c"], project_id: "project_a" }),
      thread("orphan", "Independent follow-up", { kind: "a2a", parent_id: "missing", agent_ids: ["agent_c"] }),
      thread("cross_project", "Northwind review", {
        kind: "a2a",
        parent_id: "group",
        project_id: "project_b",
        agent_ids: ["agent_c"],
      }),
      thread("archived", "Archived session", { kind: "a2a", parent_id: "home", archived: true }),
    ],
  };
}
