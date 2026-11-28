// task_*: agents work the office board through the tasks.* methods, like the owner does in the app.
import { createHash } from "node:crypto";
import {
  ErrandCategory,
  type ErrandPlace,
  type Message,
  type Task,
  TaskKind,
  TaskPriority,
  TaskTag,
} from "@apx/protocol";
import { planSteps } from "@apx/protocol/task-plan";
import { z } from "zod";
import { CATEGORY_GUIDE } from "../car/categories.ts";
import { placeName } from "../domain/owner-work.ts";
import type { Store } from "../domain/store.ts";
import { ownerWordsOf } from "../domain/task-asked.ts";
import {
  boardScope,
  checkAssignee,
  checkColumn,
  checkSettle,
  dueOf,
  NOISY_COMMENTS,
  personOf,
  taskProject,
  visibleTask,
} from "../domain/tasks.ts";
import { mentioned, mentionedElsewhere, mentionsOwner } from "../engine/office.ts";
import { badRequest, CallError } from "../errors.ts";
import { readsOutside } from "./folders.ts";
import { PLAN_CHARS } from "./plan.ts";
import { cap, fromTeam, inlineName, untrusted } from "./result.ts";
import { documentsOnly, uncommittedWork } from "./task-evidence.ts";
import { type CheckContext, defineTool, type Tool, type ToolContext } from "./types.ts";

const attachmentsArg = z
  .array(z.string().min(1).max(1000))
  .max(20)
  .optional()
  .describe("med_ ids or readable file paths to copy into the task; include the request's screenshot");
const goalArg = z.string().trim().max(500).optional().describe("what the owner checks to call it done");
const descriptionArg = z.string().max(3000).optional();
const isMediaId = (value: string) => /^med_[0-9a-f]{16}$/.test(value);
const attachmentIds = async (refs: string[] | undefined, ctx: ToolContext) =>
  refs &&
  Promise.all(
    refs.map(async (ref) => (isMediaId(ref) ? ref : (await ctx.call("media.attach", { path: ref })).media.id)),
  );

const line = (t: Task, project?: string) =>
  `- [${t.id}] ${t.title} (${[
    project ? `project ${project}` : "",
    t.state === "open" ? t.status : t.state,
    t.assignee,
    t.state === "open" && t.proposed ? "proposal: awaits owner acceptance; no new execution started" : "",
    t.awaits_owner ? "waiting for the owner" : "",
    t.person_name
      ? t.owed_by === "person"
        ? `${inlineName(t.person_name)} owes it`
        : `owed to ${inlineName(t.person_name)}`
      : "",
    t.due_at ? `due ${t.due_at}` : "",
    t.outcome ?? "",
    t.renegotiated ? `date moved ${t.renegotiated}×` : "",
    // When it last moved: what "moved today" and "quiet for days" are read from.
    `last activity ${t.activity_at.slice(0, 16).replace("T", " ")}`,
  ]
    .filter(Boolean)
    .join(", ")})`;

/**
 * Whose words a task's title and description are: the owner's, one of the owner's agents' (the owner's side,
 * DECISIONS.md#d-071), or outside text (an agent passing on a contact's request: it has a person).
 */
function taskSide(t: Pick<Task, "created_by" | "person_id">): "owner" | "team" | "outside" {
  if (t.created_by === "owner") return "owner";
  return t.person_id ? "outside" : "team";
}

/**
 * The task as written by whoever last wrote what it asks (title, description): its creator, unless an agent rewrote
 * an owner's task and the owner did not rewrite it again. An agent annotating an owner's draft is not the owner's word.
 */
export function asWritten(store: Store, t: Task): Task {
  if (t.created_by !== "owner") return t;
  const edit = store.tasks
    .events(t.id)
    .findLast((e) => e.op !== "create" && (Object.hasOwn(e.data, "title") || Object.hasOwn(e.data, "description")));
  return edit && edit.by !== "owner" && store.agents.get(edit.by) ? { ...t, created_by: edit.by } : t;
}

/** A task's words as the model reads them, enveloped by whose they are. */
export function taskWords(t: Pick<Task, "created_by" | "person_id">, words: string): string {
  const side = taskSide(t);
  if (side === "owner") return words;
  return (side === "team" ? fromTeam : untrusted)("task", { created_by: t.created_by }, words);
}

/** Titles a contact's request brought are outside data, as in a task's own chat; the owner's and agents' are not. */
function taskLines(tasks: Task[], lineOf: (t: Task) => string): string {
  const text = tasks.map(lineOf).join("\n");
  if (tasks.every((t) => taskSide(t) !== "outside")) return text;
  return untrusted("tasks", { note: "some titles come from contacts" }, text);
}

/** Past this the result cap would cut the list in the middle: the tasks that matter stay whole, the rest is counted. */
const LIST_CHARS = 10_000;
const RECENT_MS = 48 * 3600_000;

/** What a brief reads line by line: a promise, a date due within a day or past, a wait on the owner, a recent move. */
const pressing = (t: Task, at: number) =>
  t.kind === "commitment" ||
  Boolean(t.person_id) ||
  t.awaits_owner ||
  (t.due_at !== undefined && Date.parse(t.due_at) - at < 86_400_000) ||
  at - Date.parse(t.activity_at) < RECENT_MS;

/** The tasks a list cannot show whole, per project: how many, in which columns, and since when they are quiet. */
function folded(tasks: Task[], where: (t: Task) => string | undefined): string {
  const lines = [...Map.groupBy(tasks, (t) => where(t) ?? "")].map(([project, ts]) => {
    const columns = [...Map.groupBy(ts, (t) => t.status)].map(([c, n]) => `${n.length} ${c}`).join(", ");
    const last = ts.map((t) => t.activity_at).sort();
    const day = (iso: string | undefined) => (iso ?? "").slice(0, 10);
    return `- ${project ? `project ${project}` : "this project"}: ${ts.length} (${columns}), last activity ${day(last.at(-1))}, quiet since ${day(last[0])}`;
  });
  return `${tasks.length} more not listed one by one (no promise, no date due within a day, not waiting for the owner, no move in 48 hours):\n${lines.join("\n")}\nThis summary omits individual tasks: use task_list with cursor start, then each next_cursor, to enumerate them before claiming full coverage.`;
}

/** A task list for the model: every task on its line while it fits, else the pressing ones and the rest counted. */
export function boardText(tasks: Task[], where: (t: Task) => string | undefined, at = Date.now()): string {
  const lineOf = (t: Task) => line(t, where(t));
  const whole = taskLines(tasks, lineOf);
  if (whole.length <= LIST_CHARS) return whole;
  const keep = tasks.filter((t) => pressing(t, at));
  const rest = tasks.filter((t) => !pressing(t, at));
  const brief = `${keep.length ? `${taskLines(keep, lineOf)}\n` : ""}${rest.length ? folded(rest, where) : ""}`;
  if (rest.length && brief.length <= LIST_CHARS) return brief;
  // Even the urgent rows can overflow. Return only whole rows and always disclose the omission.
  const visible: Task[] = [];
  for (const t of [...keep, ...rest]) {
    if (taskLines([...visible, t], lineOf).length <= LIST_CHARS - 300) visible.push(t);
  }
  return `${visible.length ? `${taskLines(visible, lineOf)}\n` : ""}${tasks.length - visible.length} tasks omitted from this summary; use task_list with cursor start, then each next_cursor, to enumerate them before claiming full coverage.`;
}

/**
 * Where an agent's comment goes when it would only add to what the owner skips; undefined when it belongs on the task.
 * A task's comments are read by people: the turns the owner started, a message to someone, and the plan done
 * (DECISIONS.md#d-202). The rest is routed, not refused (DECISIONS.md#d-271).
 */
type CommentRoute = { to: "answer"; caller: string } | { to: "plan"; why: string } | { to: "refused"; why: string };

function commentRoute(store: Store, t: Task, text: string, ctx: ToolContext): CommentRoute | undefined {
  if (ownerWordsOf(store, ctx.run.id).length) return undefined;
  if (ctx.thread.kind === "a2a" && t.assignee !== ctx.agent.id) {
    const asker = ctx.thread.agent_ids.find((id) => id !== ctx.agent.id);
    return { to: "answer", caller: (asker && store.agents.get(asker)?.name) || "whoever asked you" };
  }
  if (mentionsOwner(store, text) || mentioned(store, text, t.project_id, ctx.agent.id).length) return undefined;
  const away = mentionedElsewhere(store, text, t.project_id)[0];
  if (away)
    return {
      to: "refused",
      why: `${inlineName(away.name)} works in another project, and a task's comments reach only this project's agents: reach it with delegate, or ask the super-agent to.`,
    };
  const steps = planSteps(t.plan ?? "");
  if (steps?.length && steps.every((s) => s.state === "done")) {
    const since = store.threads.context(t.thread_id).progress_at ?? t.created_at;
    const told = store.tasks.events(t.id).some((e) => e.op === "comment" && e.by === ctx.agent.id && e.at >= since);
    if (!told) return undefined;
  }
  // Outside the task's chat its plan is written with task_update, not plan, which is that chat's own (DECISIONS.md#d-270).
  const where = ctx.thread.task_id === t.id ? "your plan" : "the task's plan (task_update plan)";
  return {
    to: "plan",
    why: `progress lives in ${where}: mark the step and put the commit or test in its line. Comment when the whole plan is done, or to ask someone (@owner for a decision or a change of direction, @agent for a teammate).`,
  };
}

/** The plan step progress is noted on: the one being done, else the next, else the last. */
function progressStep(steps: { state: string }[]): number {
  const doing = steps.findIndex((s) => s.state === "doing");
  if (doing >= 0) return doing;
  const next = steps.findIndex((s) => s.state === "pending");
  return next >= 0 ? next : steps.length - 1;
}

/** Comments past this are full: the rest goes in the agent's answer. */
const COMMENT_CHARS = 3000;

/**
 * Writing on the board is the owner's own record and runs even with outside content in the turn. Handing work to a
 * teammate (an assignee, an @mention) does too, like `delegate`: the turn it starts works in the mode of whoever
 * asked for it (DECISIONS.md#d-073, #d-106).
 */
const handsOff = "never" as const;

const commitmentArgs = {
  person: z.string().max(80).optional(),
  owed_by: z.enum(["owner", "person"]).optional(),
  due_at: z.string().max(40).optional(),
};

/** An errand's place as agents give it; categories are plain words checked here, the guide already lists them. */
const placeArg = z
  .object({
    categories: z.array(z.string().max(20)).max(4).optional(),
    brand: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .optional();
const errandPlaceOf = (p: z.output<typeof placeArg>): ErrandPlace | undefined =>
  p && {
    categories: (p.categories ?? []).flatMap((c) => {
      const r = ErrandCategory.safeParse(c);
      return r.success ? [r.data] : [];
    }),
    ...(p.brand ? { brand: p.brand } : {}),
  };

const shapeArgs = {
  kind: TaskKind.optional(),
  place: placeArg,
  priority: TaskPriority.optional(),
  tags: z.array(TaskTag).max(12).optional(),
};

/** What the shared fields mean, told once on task_create: task_update takes them as they are. */
const ABOUT: Record<string, string> = {
  person: "a commitment's contact",
  owed_by: 'who promised it: "owner" (default) or "person"',
  due_at: "2026-10-05 or an ISO moment",
  kind: '"commitment": owed to or by a person; "errand": small, on the way',
  place: `errand: where. ${CATEGORY_GUIDE}`,
  priority: "default normal",
  tags: "short labels (client, area…)",
};
const described = <T extends Record<string, z.ZodType>>(fields: T): T =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, ABOUT[k] ? v.describe(ABOUT[k]) : v])) as T;

/** One argument's check, as the methods run it; a failure names the argument ("assignee: agent x not found"). */
/** The shortest note that can say what was verified, or what the owner must do. */
const MIN_EVIDENCE = 12;

function field<T>(name: string, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (!(err instanceof CallError) || err.shape.message.startsWith(`${name} `)) throw err;
    throw new CallError({ ...err.shape, message: `${name}: ${err.shape.message}` });
  }
}

const UNSPECIFIED = "It has not started: add a non-empty description with task_update to start the assigned agent.";

/** What an agent is told when the task it gave waits for the owner: this chat's chain is paused (DECISIONS.md#d-082). */
const PAUSED = (who: string) =>
  `It has not started: agents here reached the owner's limit for working on their own, so ${who} starts on it once the owner lets them go on (they were told). Do not assign it again.`;

const DESCRIPTION_PAGE = 4_000;
const EXHAUSTIVE_PAGE = 25;

/** True when `cap` over the task's JSON drops part of its description: asked of `cap` itself, so they cannot drift. */
export function descriptionCut(task: Task, budget: number): boolean {
  return !cap(JSON.stringify(task), budget).includes(`"description":${JSON.stringify(task.description)}`);
}

/** One bounded page of a description; the revision stops a read from mixing text of two versions. */
function descriptionPage(task: Task, page: string): string {
  const [from = "", revision] = page.split(":");
  const offset = Number(from);
  if (!/^\d+$/.test(from) || !Number.isSafeInteger(offset)) throw badRequest("description_page: use 0, then next_page");
  const content = task.description;
  const current = createHash("sha256").update(content).digest("hex");
  if (offset > 0 && !revision) throw badRequest("revision is required after the first page");
  if (revision && revision !== current) throw badRequest("description changed; restart from offset 0");
  if (offset > content.length) throw badRequest("offset is beyond the description");
  const high = (i: number) => /[\uD800-\uDBFF]/.test(content[i] ?? "");
  const low = (i: number) => /[\uDC00-\uDFFF]/.test(content[i] ?? "");
  if (offset > 0 && high(offset - 1) && low(offset)) throw badRequest("offset splits a Unicode character");
  let end = Math.min(offset + DESCRIPTION_PAGE, content.length);
  // Do not split a Unicode surrogate pair across independently decoded pages.
  if (end < content.length && high(end - 1) && low(end)) end--;
  return JSON.stringify({
    task: task.id,
    revision: current,
    offset,
    total: content.length,
    text: content.slice(offset, end),
    next_page: end < content.length ? `${end}:${current}` : null,
  });
}

export function taskTools(store: Store, home: string): Tool[] {
  const outsideAssets = (a: { attachments?: string[] }, ctx: CheckContext) =>
    readsOutside(
      store,
      home,
      ctx.thread,
      (a.attachments ?? []).filter((ref) => !isMediaId(ref)),
    );
  /** Whether this chat keeps the task's start until the owner lets agents go on. */
  const waits = (task: string, ctx: CheckContext) =>
    Boolean(store.threads.context(ctx.thread.id).held?.some((h) => h.task === task));
  const scopeOf = (ctx: CheckContext) => boardScope(store, { id: ctx.agent.id, thread_id: ctx.thread.id });
  /** Where a task acted on from another project's chat is, so the result records it (DECISIONS.md#d-271). */
  const placeOf = (t: Pick<Task, "project_id">, ctx: CheckContext) =>
    t.project_id && t.project_id !== ctx.thread.project_id ? ` This task is in ${placeName(store, t.project_id)}.` : "";
  const taskOf = (id: string, ctx: CheckContext) => field("task", () => visibleTask(store, id, scopeOf(ctx)));
  /** What a new task or a change names besides the task: a real column, assignee and person, a date that reads. */
  const checkNamed = (
    a: { status?: string | undefined; assignee?: string | null | undefined; person?: string | undefined },
    due: string | undefined,
    project: string | undefined,
  ) => {
    field("status", () => checkColumn(store, a.status));
    field("assignee", () => checkAssignee(store, a.assignee, project, true));
    const person = a.person;
    if (person) field("person", () => personOf(store, person));
    field("due_at", () => dueOf(due));
  };
  /** What a new task's creator is told: whether it started, waits, or transferred this turn's work. */
  const createdText = (t: Task, ctx: ToolContext): string => {
    const under = t.parent_id ? `, a subtask of ${t.parent_id}` : "";
    if (t.proposed)
      return `proposed ${t.id}${under}: it starts when the owner accepts it. Tell them what you proposed and why, in one line each.`;
    // Unassigned tasks are valid capture-only records, not work already in progress.
    if (!t.assignee && t.kind === "task")
      return `created ${t.id} in ${t.status}${under}, unassigned: capture only, no execution started. If the owner only wanted to record it, you are done. Assign with task_update and a description only when execution is wanted.`;
    if (t.assignee && !t.description.trim()) return `created ${t.id} in ${t.status}${under}. ${UNSPECIFIED}`;
    // Its close reports back to this chat (DECISIONS.md#d-076): no need to watch the board for it.
    const back =
      t.assignee !== ctx.agent.id && ctx.thread.kind !== "a2a" ? " When they close it, their report comes here." : "";
    if (t.assignee && waits(t.id, ctx)) return `created ${t.id} in ${t.status}${under}. ${PAUSED(t.assignee)}`;
    if (store.threads.context(ctx.thread.id).task_handoff?.run === ctx.run.id)
      return `created ${t.id} in ${t.status}${under}. Execution transferred to its task session with the existing findings. End this turn; do not do more work here. Its closing report comes back here.`;
    return `created ${t.id} in ${t.status}${under}.${t.assignee ? ` ${t.assignee} starts on it ${t.start_at && t.start_at > new Date().toISOString() ? `at ${t.start_at}` : "now"}.${back}` : ""}`;
  };
  /** This turn's own comment on the task, if it posted one; a turn's own answer (it has a run) is never one. */
  const turnComment = (t: Task, ctx: ToolContext): Message | undefined =>
    store.messages
      .list(t.thread_id, 30)
      .findLast(
        (m) =>
          m.author.kind === "agent" &&
          m.author.id === ctx.agent.id &&
          !m.run_id &&
          m.created_at >= ctx.run.started_at &&
          m.parts.some((p) => p.type === "text"),
      );
  /** More of this turn's words join its comment, within what a comment holds. */
  const addToComment = (t: Task, m: Message, text: string): string => {
    const at = m.parts.findLastIndex((p) => p.type === "text");
    const part = m.parts[at];
    if (part?.type !== "text") return "";
    const joined = `${part.text}\n\n${text}`;
    if (joined.length > COMMENT_CHARS)
      return "not added: this turn's comment on the task is full. Say the rest in your answer, or in one comment next turn.";
    store.messages.update({ ...m, parts: m.parts.map((p, i) => (i === at ? { ...part, text: joined } : p)) });
    store.tasks.touched(t.id, m.author.kind === "agent" ? m.author.id : "owner", "update");
    return "added to your comment on the task from this turn (one comment a turn).";
  };
  /** Progress noted where it lives: on the plan's current step, or the task's history when it has no plan. */
  const noteProgress = async (t: Task, text: string, ctx: ToolContext): Promise<string> => {
    const steps = planSteps(t.plan ?? "");
    const said = text.replace(/\s+/g, " ").trim().slice(0, 300);
    if (steps?.length) {
      const at = progressStep(steps);
      const plan = (t.plan ?? "")
        .split("\n")
        .filter((l) => l.trim())
        .map((l, i) => (i === at && !l.includes(said) ? `${l} (${said})` : l))
        .join("\n");
      if (plan.length <= PLAN_CHARS) {
        try {
          await ctx.call("tasks.update", { task: t.id, plan });
          return `noted on the plan's step "${steps[at]?.step}", not posted as a comment.`;
        } catch {
          // A plan this caller may not rewrite: the note still lands in the task's history below.
        }
      }
    }
    store.tasks.change(t.id, {}, ctx.agent.id, said);
    return "noted in the task's history, not posted as a comment.";
  };
  /** A helper that opened work tells whoever asked it, in its answer (DECISIONS.md#d-271). */
  const openedFor = (t: Task, ctx: ToolContext) =>
    ctx.thread.kind === "a2a" && t.assignee && !t.proposed
      ? ` Say in your answer that you opened ${t.id}, so whoever asked you knows.`
      : "";
  return [
    defineTool({
      name: "task_get",
      description:
        "Read task details, history, sessions, consults, subtasks, usage and recent comments with saved evidence.",
      args: z.object({
        task: z.string().min(1).max(64),
        description_page: z.string().optional(),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Read a task",
      async run(a, ctx) {
        const r = await ctx.call("tasks.get", { task: a.task });
        if (a.description_page !== undefined)
          return untrusted("task_description", {}, descriptionPage(r.task, a.description_page));
        const section = (name: string, data: unknown, budget: number) =>
          `${name}:\n${cap(JSON.stringify(data), budget)}`;
        const chat = (t: (typeof r.sessions)[number]) => ({
          id: t.id,
          title: t.title,
          agent_ids: t.agent_ids,
          state: t.state,
        });
        return untrusted(
          "task_detail",
          {},
          [
            section("Task", r.task, 2_000),
            ...(descriptionCut(r.task, 2_000)
              ? ["The description is cut. Call task_get again with description_page 0 to read it in full."]
              : []),
            section(
              "Attachments (untrusted; file_read to inspect, send_file to share here by media_id)",
              r.attachments,
              12_000,
            ),
            section("History", r.events, 1_800),
            section("Sessions", r.sessions.map(chat), 600),
            section("Consults", r.consults.map(chat), 600),
            section("Subtasks", r.subtasks, 900),
            section("Usage", r.usage, 400),
            section(
              `Comments (latest ${r.comments.length}${r.comments_truncated ? "; older messages omitted" : ""})`,
              r.comments.map(({ id, author, created_at, parts }) => ({ id, author, created_at, parts })),
              4_000,
            ),
          ].join("\n\n"),
        );
      },
    }),
    defineTool({
      name: "task_list",
      description:
        "List this project's tasks by newest activity (default open), with ids, columns, commitments; project: another one's.",
      args: z.object({
        project: z.string().min(1).max(80).optional().describe("id or name"),
        mine: z.boolean().optional(),
        state: z.enum(["open", "done", "dropped"]).optional(),
        commitments: z.boolean().optional().describe("Only commitments (person on the other side)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows, default 200."),
        cursor: z.string().optional(),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: () => "Looked at the tasks",
      async run(a, ctx) {
        // One argument drives the traversal: "start" for the first page, then each page's next_cursor.
        const exhaustive = a.cursor !== undefined;
        const after = a.cursor && a.cursor !== "start" ? a.cursor : undefined;
        const key = a.project?.trim().toLowerCase();
        const named = key
          ? store.projects.list().find((p) => p.id === a.project || p.name.toLowerCase() === key)
          : undefined;
        if (a.project && !named)
          return `no project "${a.project}". Projects: ${store.projects
            .list()
            .slice(0, 30)
            .map((p) => p.name)
            .join(", ")}`;
        const elsewhere = named && named.id !== ctx.thread.project_id ? named.id : undefined;
        if (elsewhere && scopeOf(ctx) && !scopeOf(ctx)?.owner) return "this chat lists only its own project's tasks.";
        const head = elsewhere ? `${placeName(store, elsewhere)}:\n` : "";
        const r = await ctx.call("tasks.list", {
          ...(elsewhere ? { project: elsewhere } : {}),
          ...(a.state ? { state: a.state } : {}),
          ...(a.mine ? { assignee: ctx.agent.id } : {}),
          ...(a.commitments ? { commitments: true } : {}),
          ...(a.limit ? { limit: exhaustive ? Math.min(a.limit, EXHAUSTIVE_PAGE) : a.limit } : {}),
          ...(exhaustive ? { limit: Math.min(a.limit ?? EXHAUSTIVE_PAGE, EXHAUSTIVE_PAGE), exhaustive: true } : {}),
          ...(after ? { after } : {}),
        });
        if (exhaustive) {
          // Fixed-width summaries keep every ID and cursor inside the tool result cap, even for very long titles.
          const rowOf = (t: Task) =>
            `- [${t.id}] ${Array.from(t.title.slice(0, 120), (c) => (c.charCodeAt(0) < 32 ? " " : c)).join("")} (${(t.state === "open" ? t.status : t.state).slice(0, 80)}, project ${t.project_id ?? "global"}${t.assignee ? `, ${t.assignee}` : ""}${t.state === "open" && t.proposed ? ", proposal: awaits owner acceptance" : ""})`;
          // Whole rows only: if a page would pass the list cap, it ends earlier and the cursor follows the last row shown.
          const shown: Task[] = [];
          for (const t of r.tasks) {
            if (taskLines([...shown, t], rowOf).length > LIST_CHARS - 300) break;
            shown.push(t);
          }
          const more = shown.length < r.tasks.length || Boolean(r.next_cursor);
          const cursor = more ? (shown.at(-1)?.id ?? null) : null;
          return `${head}${taskLines(shown, rowOf) || "no matching tasks"}\nnext_cursor: ${cursor ?? "none"}. This is a live traversal, not a snapshot; repeat if tasks changed.`;
        }
        const cols = `columns: ${r.columns.map((c) => c.id).join(", ")}`;
        // Tasks from more than one place: each says which project it is in (by name, as the owner calls it).
        const many = new Set(r.tasks.map((t) => t.project_id ?? "")).size > 1;
        const listed = many ? await ctx.call("projects.list", {}) : undefined;
        const names = new Map(listed?.projects.map((p) => [p.id, p.name]));
        const where = (t: Task) =>
          listed ? (t.project_id ? (names.get(t.project_id) ?? t.project_id) : listed.base.name) : undefined;
        if (r.tasks.length)
          return `${head}${boardText(r.tasks, where)}\n${cols}${r.truncated ? "\nMore tasks exist; use cursor start to enumerate every matching task." : ""}`;
        // An empty filtered list is not an empty board: say what was asked and what else is open.
        const scope = [a.state ?? "open", a.mine ? "assigned to you" : "", a.commitments ? "commitments" : ""];
        const empty = `no tasks (${scope.filter(Boolean).join(", ")}).`;
        if (!a.mine && !a.commitments && (a.state ?? "open") === "open") return `${head}${empty} ${cols}`;
        const open = (await ctx.call("tasks.list", elsewhere ? { project: elsewhere } : {})).tasks;
        const by = Map.groupBy(open, (t) => t.status);
        const spread = [...by].map(([status, ts]) => `${ts.length} ${status}`).join(", ");
        return `${head}${empty} The board has ${open.length} open${open.length ? ` (${spread})` : ""}; task_list with no filters lists them. ${cols}`;
      },
    }),
    defineTool({
      name: "task_create",
      description:
        "Not for what the owner waits for here and fits this turn: do it now. First task_list: if an open task is the same or close, continue that one. Record requested tasks or track long work, not every action. Capture only: omit assignee; nothing starts. To execute, give assignee, goal and a description in short Markdown lines: assignment starts its session, never also delegate it. Self-assigning now transfers execution: end this turn. Reviews or another area's work: propose it (a delegate, to its caller). A promise: person, owed_by, due_at.",
      args: z.object({
        title: z.string().trim().min(3).max(200),
        goal: goalArg,
        description: descriptionArg,
        attachments: attachmentsArg,
        assignee: z.string().max(80).optional(),
        project: z.string().min(1).max(80).optional().describe("project id; default this chat's"),
        status: z.string().max(40).optional(),
        ...described(shapeArgs),
        ...described(commitmentArgs),
        start_at: z.string().max(40).optional().describe("work begins"),
        propose: z.boolean().optional().describe("a chip the owner accepts before work starts"),
      }),
      effect: "local",
      outside: outsideAssets,
      confirm: handsOff,
      check: (a, ctx) => {
        checkNamed(a, a.due_at, taskProject(store, { id: ctx.agent.id, thread_id: ctx.thread.id }, a));
        // Work handed on needs its arrival point, or whoever does it cannot tell when it drifts (DECISIONS.md#d-187).
        if (a.assignee && !a.propose && !a.goal?.trim())
          throw badRequest("goal: say in a line where this work must arrive, as the owner would check it");
      },
      deadlineMs: 5_000,
      title: (a) => `Created the task ${String(a.title ?? "").slice(0, 60)}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.create", {
          ...a,
          place: errandPlaceOf(a.place),
          attachments: await attachmentIds(a.attachments, ctx),
        });
        return `${createdText(t, ctx)}${placeOf(t, ctx)}${openedFor(t, ctx)}`;
      },
    }),
    defineTool({
      name: "task_update",
      description: "Update a task's fields (as in task_create); null assignee/parent clears it. task_close ends it.",
      args: z.object({
        task: z.string().min(1).max(64),
        parent: z.string().min(1).max(64).nullable().optional(),
        status: z.string().max(40).optional(),
        assignee: z.string().max(80).nullable().optional(),
        title: z.string().trim().min(3).max(200).optional(),
        goal: z.string().trim().max(500).optional(),
        description: descriptionArg,
        attachments: attachmentsArg,
        awaits_owner: z.boolean().optional(),
        why: z
          .string()
          .trim()
          .max(1000)
          .optional()
          .describe("awaits_owner: a separate manual blocker, not an ask_owner card"),
        plan: z.string().max(4000).optional().describe("its checklist (- [x], - [~], - [ ]); in its own chat use plan"),
        reviewer: z.string().max(80).optional().describe('"owner" or agent'),
        ...shapeArgs,
        ...commitmentArgs,
      }),
      effect: "local",
      outside: outsideAssets,
      confirm: handsOff,
      check: (a, ctx) => {
        checkNamed(a, a.due_at, taskOf(a.task, ctx).project_id);
        // Waiting on the owner stops the work: they must be told what for, or it waits forever.
        if (a.awaits_owner && (a.why?.length ?? 0) < MIN_EVIDENCE)
          throw badRequest("why: say what the owner must do or decide; being hard or long is not waiting on them.");
      },
      deadlineMs: 5_000,
      title: (a) => `Updated the task ${String(a.task ?? "")}`,
      async run({ task, why, ...c }, ctx) {
        const attachments = await attachmentIds(c.attachments, ctx);
        const t = await ctx.call("tasks.update", { task, ...c, place: errandPlaceOf(c.place), attachments });
        // What the owner must decide shows with the files it is about, not only in the task's attachments.
        const files = attachments?.slice(0, 5);
        if (c.awaits_owner && why)
          await ctx.call("tasks.comment", { task, text: why, ...(files?.length ? { attachments: files } : {}) });
        if (c.assignee && t.proposed)
          return `proposed ${t.id} for ${t.assignee}: it starts when the owner accepts it. Tell them what you proposed and why, in one line.`;
        const pending = t.assignee && !t.description.trim() && t.chats === 0 ? ` ${UNSPECIFIED}` : "";
        const paused = !pending && t.assignee && waits(t.id, ctx) ? ` ${PAUSED(t.assignee)}` : "";
        const transferred =
          store.threads.context(ctx.thread.id).task_handoff?.run === ctx.run.id
            ? " Execution transferred to its task session. End this turn; do not do more work here."
            : "";
        return `updated: ${taskLines([t], (x) => line(x))}${pending}${paused}${transferred}${placeOf(t, ctx)}`;
      },
    }),
    defineTool({
      name: "task_comment",
      description:
        "Comment on a task when its plan is done or to ask: @owner asks the owner, until they reply; @agent a teammate, and you get the answer. attachments: the files it is about (to review, the final version), shown with it.",
      args: z.object({
        task: z.string().min(1).max(64),
        text: z.string().trim().min(1).max(1500),
        attachments: z.array(z.string().min(1).max(1000)).max(5).optional().describe("med_ ids or readable file paths"),
      }),
      effect: "local",
      outside: outsideAssets,
      confirm: handsOff,
      check: (a, ctx) => void taskOf(a.task, ctx),
      deadlineMs: 5_000,
      title: (a) => `Commented on ${String(a.task ?? "")}`,
      async run(a, ctx) {
        const t = taskOf(a.task, ctx);
        const where = placeOf(t, ctx);
        const route = commentRoute(store, t, a.text, ctx);
        if (route?.to === "refused") throw badRequest(`not posted: ${route.why}`);
        if (route?.to === "answer")
          return `not posted on the task: you are answering ${route.caller}, so this is part of your answer to them. Say it there; they decide what reaches the task.`;
        // One comment a turn (D-188): more words this turn join it, unless they ask someone or carry files.
        const mine = turnComment(t, ctx);
        const asks = mentionsOwner(store, a.text) || mentioned(store, a.text, t.project_id, ctx.agent.id).length > 0;
        const joins = Boolean(mine) && !asks && !a.attachments?.length;
        // With the plan done, more words this turn belong with its report, not in the last step's line.
        const planDone = Boolean(planSteps(t.plan ?? "")?.every((s) => s.state === "done"));
        if (route?.to === "plan" && !(joins && planDone))
          return `${await noteProgress(t, a.text, ctx)} ${route.why}${where}`;
        if (mine && joins) return addToComment(t, mine, a.text) + where;
        const attachments = await attachmentIds(a.attachments?.length ? a.attachments : undefined, ctx);
        const r = await ctx.call("tasks.comment", {
          task: a.task,
          text: a.text,
          ...(attachments ? { attachments } : {}),
        });
        const files = r.message.parts.filter((p) => p.type === "file" || p.type === "image").length;
        const shown = files ? ` ${files} file(s) shown with it.` : "";
        return r.runs.length
          ? `commented;${shown} ${r.runs.length} agent(s) will answer there, and the answer comes back to you: do not wait for it.${where}`
          : `commented.${shown}${where}`;
      },
    }),
    defineTool({
      name: "task_tidy",
      description:
        "Clean tasks' comments. No task: the open tasks that piled them up. A task: its agents' comments. With the owner's yes, remove takes out those that add nothing (progress notes, repeats) and summary leaves one comment with what still matters.",
      args: z.object({
        task: z.string().min(1).max(64).optional(),
        remove: z.array(z.string().min(1).max(64)).max(500).optional(),
        summary: z.string().trim().min(1).max(3000).optional(),
      }),
      effect: "local",
      // Offered only while some open task piled up comments: every other turn would carry it for nothing.
      when: () => store.tasks.noisy(NOISY_COMMENTS, 1).length > 0,
      // Deleting is never silent: the owner sees each clean-up on its card, whatever the mode.
      confirm: (a) => (a.remove?.length ? "always" : "never"),
      // Removing is the owner's to decide, on their own word (DECISIONS.md#d-140).
      ownerSetting: (a) => Boolean(a.remove?.length),
      keepsCard: (a) => (a.remove?.length ? "card" : undefined),
      explain: (a) =>
        a.remove?.length
          ? `Remove ${a.remove.length} comment(s) from ${a.task}${a.summary ? `, leaving this summary:\n${a.summary}` : ""}`
          : undefined,
      check: (a, ctx) => {
        if (a.task) taskOf(a.task, ctx);
        else if (a.remove?.length) throw badRequest("task: say which task the comments to remove are on");
      },
      deadlineMs: 10_000,
      title: (a) =>
        a.remove?.length
          ? `Cleaned ${a.remove.length} comments of ${String(a.task)}`
          : a.task
            ? `Read the comments of ${String(a.task)}`
            : "Looked for tasks with many comments",
      async run(a, ctx) {
        if (!a.task) {
          const scope = scopeOf(ctx);
          const lines = store.tasks.noisy(NOISY_COMMENTS).flatMap((id) => {
            const t = store.tasks.get(id);
            if (!t) return [];
            try {
              visibleTask(store, id, scope);
            } catch {
              return [];
            }
            const n = store.messages.list(t.thread_id, 1000).filter((m) => m.author.kind === "agent").length;
            return [`- ${t.id} · ${n} agent messages · ${t.title}`];
          });
          return lines.length ? untrusted("tasks", {}, lines.join("\n")) : "no open task piled up comments.";
        }
        const t = taskOf(a.task, ctx);
        if (a.remove?.length) {
          const r = await ctx.call("tasks.tidy", { task: t.id, remove: a.remove, summary: a.summary });
          return `removed ${r.removed}${r.kept.length ? `; kept (not an agent's plain comment on it): ${r.kept.join(", ")}` : ""}${r.message ? "; summary posted" : ""}.${placeOf(t, ctx)}`;
        }
        const name = (id: string) => store.agents.get(id)?.name ?? id;
        const rows = store.messages
          .list(t.thread_id, 1000)
          .filter((m) => m.author.kind === "agent" && m.parts.every((p) => p.type === "text"))
          .map((m) => {
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ");
            const who = m.author.kind === "agent" ? name(m.author.id) : "";
            return `- ${m.id} · ${who} · ${m.created_at.slice(0, 16)} · ${text.replace(/\s+/g, " ").slice(0, 160)}`;
          });
        if (!rows.length) return "no agent comments on this task.";
        return untrusted("task_comments", { task: t.id, count: String(rows.length) }, cap(rows.join("\n"), 60_000));
      },
    }),
    defineTool({
      name: "task_close",
      description:
        "Close a task, or reopen it. Closing your own work as done: note says what you verified. Request corrections with state:open, rework:true and a note.",
      args: z.object({
        task: z.string().min(1).max(64),
        state: z.enum(["done", "dropped", "open"]),
        note: z.string().max(2000).optional(),
        rework: z.boolean().optional(),
      }),
      effect: "local",
      check: async (a, ctx) => {
        const t = taskOf(a.task, ctx);
        // Done is a claim about the work: the one who did it says what shows it (DECISIONS.md#d-162).
        if (a.state === "done" && t.assignee === ctx.agent.id && (a.note?.trim().length ?? 0) < MIN_EVIDENCE)
          throw badRequest(
            "note: say in a line what you verified (a test or build that passed, a page or file you checked). If it is not verified yet, verify it first; if something is left, do it before closing.",
          );
        // Writing about the work is not doing it: asked once, so a task that wanted a document still closes.
        const docs = a.state === "done" && t.assignee === ctx.agent.id ? documentsOnly(store, t) : undefined;
        if (docs && !store.threads.context(t.thread_id).documents_checked) {
          store.threads.mergeContext(t.thread_id, { documents_checked: true });
          throw badRequest(
            `not closed: this task's work only wrote ${docs.slice(0, 3).join(", ")} and ran no command. If the task asked for a change (code, a fix, a setup), make it and check it now, then close. If a document was the deliverable, close again.`,
          );
        }
        // Work left uncommitted in its worktree reaches nobody: asked once, so a close that means it still goes.
        if (a.state !== "done" || t.assignee !== ctx.agent.id || store.threads.context(t.thread_id).commit_checked)
          return;
        const left = await uncommittedWork(store, home, t);
        if (!left.length) return;
        store.threads.mergeContext(t.thread_id, { commit_checked: true });
        const where = left.map((w) => `${w.dir}${w.branch ? ` (branch ${w.branch})` : ""}: ${w.changes} changed`);
        throw badRequest(
          `not closed: uncommitted work in ${where.join("; ")}. Commit it on its branch, then close again and name the branch in the note. If it is not this task's work, say so in the note and close again.`,
        );
      },
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.state ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.close", a);
        return `now ${t.state}.${placeOf(t, ctx)}`;
      },
    }),
    defineTool({
      name: "commitment_settle",
      description:
        "Record how a commitment went, as the owner said it: kept, missed, dropped (released by agreement) or renegotiated (a new date agreed with the person: give due_at). Never decide it yourself.",
      args: z.object({
        task: z.string().min(1).max(64),
        outcome: z.enum(["kept", "missed", "dropped", "renegotiated"]),
        due_at: z.string().max(40).optional().describe("Renegotiated: the new date (2026-10-05 or ISO)."),
        note: z.string().max(2000).optional(),
      }),
      effect: "local",
      check: (a, ctx) => checkSettle(taskOf(a.task, ctx), a.outcome, a.due_at),
      deadlineMs: 5_000,
      title: (a) => `Marked ${String(a.task ?? "")} ${String(a.outcome ?? "")}`,
      async run(a, ctx) {
        const t = await ctx.call("tasks.settle", a);
        const said =
          t.state === "open" ? `still open, now due ${t.due_at ?? "?"}.` : `closed: ${t.outcome ?? t.state}.`;
        return `${said}${placeOf(t, ctx)}`;
      },
    }),
  ];
}
