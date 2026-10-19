import { Agent, Project, Thread } from "@apx/protocol";

const at = new Date();
const ago = (hours: number) => new Date(at.getTime() - hours * 3_600_000).toISOString();
export const previewProjects = [
  Project.parse({ id: "research", name: "Northwind" }),
  Project.parse({ id: "review", name: "Acme" }),
];
const agent = (id: string, name: string, blob: string, project_id?: string) =>
  Agent.parse({ id, name, blob, project_id, kind: "agent", created_at: ago(80), updated_at: ago(0) });
export const previewAgents = [
  agent("assistant", "Assistant", "noche"),
  agent("researcher", "Researcher", "menta", "research"),
  agent("reviewer", "Reviewer", "coral", "review"),
];
const chat = (id: string, extra: Partial<Thread> = {}) =>
  Thread.parse({
    id,
    title: "Project planning",
    kind: "agent",
    agent_ids: ["assistant"],
    state: "completed",
    preview: "The plan is ready to review.",
    unread: 0,
    created_at: ago(80),
    updated_at: ago(1),
    ...extra,
  });
export const previewThreads = [
  chat("ordinary", { pinned: true }),
  chat("group", {
    kind: "group",
    title: "Launch team",
    agent_ids: ["assistant", "researcher", "reviewer"],
    preview: "The team is reviewing the launch checklist.",
  }),
  chat("caller", { title: "Compare suppliers", unread: 2 }),
  chat("consult", {
    kind: "a2a",
    parent_id: "caller",
    agent_ids: ["researcher"],
    title: "Assistant → Researcher: Supplier comparison",
    unread: 1,
  }),
  chat("review", {
    kind: "a2a",
    parent_id: "consult",
    agent_ids: ["reviewer"],
    title: "Researcher → Reviewer: Check the sources",
  }),
  ...Array.from({ length: 7 }, (_, i) =>
    chat(`daily-${i}`, {
      kind: "routine",
      routine_id: "daily",
      title: `Daily brief · Run ${i + 1}`,
      updated_at: ago(i * 24 + 0.1),
      preview: i === 0 ? "Your morning summary is ready." : `Previous summary ${i + 1}`,
      unread: i < 2 ? 1 : 0,
    }),
  ),
  chat("routine-consult", {
    kind: "a2a",
    parent_id: "daily-0",
    agent_ids: ["researcher"],
    title: "Assistant → Researcher: Verify the forecast",
  }),
  chat("other-routine", {
    kind: "routine",
    routine_id: "other",
    title: "Daily brief · Other schedule",
    agent_ids: ["researcher"],
    preview: "A different routine with the same name.",
  }),
  chat("failed-routine", {
    kind: "routine",
    routine_id: "sync",
    title: "Sync reports · Run 1",
    state: "failed",
    preview: "The report could not be read.",
    unread: 1,
  }),
  chat("waiting-routine", {
    kind: "routine",
    routine_id: "sync",
    title: "Sync reports · Run 2",
    state: "input-required",
    preview: "I need approval to continue.",
    updated_at: ago(0),
  }),
  chat("quiet-routine", { kind: "routine", routine_id: "daily", archived: true }),
  chat("task-dev", { task_id: "preview-task", title: "Prepare release", preview: "Implementation complete." }),
  chat("task-review", {
    task_id: "preview-task",
    title: "Prepare release",
    agent_ids: ["reviewer"],
    preview: "Review complete.",
  }),
  chat("task-consult", {
    kind: "a2a",
    parent_id: "task-dev",
    agent_ids: ["researcher"],
    title: "Assistant → Researcher: Check dependencies",
  }),
  chat("engine", { kind: "code", engine: "codex", title: "Update the dashboard" }),
  chat("old", { title: "Last week's notes", updated_at: ago(120) }),
];
