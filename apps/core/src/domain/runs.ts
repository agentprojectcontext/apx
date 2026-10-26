// Runs (one agent turn each) and their tool steps. A run row is written, with its input, before anything runs:
// the runs table is also the durable queue a restart picks up from.
import type { HarnessId, Run, RunEndReason, RunState, RunTrigger } from "@apx/protocol";
import { sql as raw, type Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { RunsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";
import type { ThreadContext } from "./threads.ts";

/** Who a run's input comes from. Stamped by the core, never parsed from text. */
export type Origin =
  | { kind: "user"; message_id?: string }
  | { kind: "agent"; id: string; name: string; thread_id: string; run_id: string }
  | { kind: "surface"; id: string; title: string }
  /** A message on a channel (Telegram…): from the owner, or from a contact (then it is a third party's text). */
  | {
      kind: "channel";
      channel: string;
      conversation: string;
      person_id: string;
      name: string;
      role: "owner" | "contact";
      /** The message it came in as; stamped for the owner's, which memory may quote. */
      message_id?: string;
    }
  /**
   * A contact wrote outside their channel's hours and the hours have begun: their kept messages are in the chat, and
   * this turn answers them (a third party's words, like a contact's channel message). See DECISIONS.md#d-136
   */
  | {
      kind: "hours_began";
      channel: string;
      conversation: string;
      person_id: string;
      name: string;
      /** When the first of them came. */
      since: string;
    }
  /** A routine the owner scheduled: its prompt is the owner's own words. */
  | { kind: "routine"; id: string; name: string }
  /** The owner answered something the agent asked, after the turn that asked had ended. */
  | { kind: "input_answer"; input_id: string }
  /** A background command the agent started has ended. */
  | { kind: "job"; job_id: string; command: string; state: RunState; exit_code: number | null }
  /** A command the agent suggested, which the owner ran in a terminal, has ended. */
  | { kind: "terminal"; terminal_id: string; command: string; exit_code: number | null }
  /** The owner let agents go on after a pause: with a fresh budget, or with no limit this round (DECISIONS.md#d-081). */
  | { kind: "go_on"; mode: "reset" | "release" }
  /** APX found the agent's task open with nothing running on it, and asks it once to go on (engine/task-stall.ts). */
  | { kind: "stalled_task"; task_id: string; title: string }
  /** The computer the agent started in this chat is up, or did not start (environments/ready.ts). */
  | { kind: "computer_ready"; ready: boolean; error?: string }
  /** A task an agent created and gave to another one was closed by that one (DECISIONS.md#d-076). */
  | { kind: "task_result"; task_id: string; title: string; state: "done" | "dropped"; agent_id: string; name: string }
  | {
      kind: "delegation_result";
      agent_id: string;
      name: string;
      thread_id: string;
      run_id: string;
      state: RunState;
      /** Why it ended (`step_limit`: it reported progress, not a result); absent on runs older than the field. */
      end_reason?: RunEndReason;
      /** Its calls with an effect as APX recorded them (`actionsOf`), absent on runs older than the field. */
      actions?: string[];
      /** The session's name, to continue it with its context. */
      session?: string;
      /** Why APX stopped going on with it after a limit cut it short (DECISIONS.md#d-116): the owner decides. */
      stopped?: string;
      /** How it went when not well (`outcomeOf`): no answer, failed actions, an error. */
      outcome?: { level: "warn" | "error"; why: string };
    };

/**
 * What speaks for the owner in a chat on the computer, and so may run there: their words (from the app or as the owner
 * on a channel), their answers, what they set running, and their own agents' results. A contact, a widget or an
 * outside app's agent never runs on it (DECISIONS.md#d-151).
 */
export const runsOnComputer = (o: Origin): boolean => {
  switch (o.kind) {
    case "user":
    case "input_answer":
    case "computer_ready":
    case "go_on":
    case "job":
    case "terminal":
    case "routine":
    case "stalled_task":
    case "task_result":
    case "delegation_result":
      return true;
    case "channel":
      return o.role === "owner";
    case "agent":
      return o.id !== "external" && !o.id.startsWith("client:");
    default:
      return false;
  }
};

/** The owner speaking: from the app, or on a channel as the owner (never a contact). */
export const ownerOrigin = (o: Origin | undefined): o is Extract<Origin, { kind: "user" | "channel" }> =>
  o?.kind === "user" || (o?.kind === "channel" && o.role === "owner");

/**
 * The owner asked for this run: their own message, or their answer to something asked in a run they had asked for.
 * An answer to a question another agent's, a contact's or a job's run raised is not their word on that run's request.
 * `askedIn` gives the origin of the run that raised an input.
 */
export function ownerAsked(
  o: Origin | undefined,
  askedIn: (inputId: string) => Origin | undefined,
  depth = 0,
): boolean {
  if (ownerOrigin(o)) return true;
  if (o?.kind !== "input_answer" || depth >= 10) return false;
  return ownerAsked(askedIn(o.input_id), askedIn, depth + 1);
}

/** The session of the sub-thread where the super-agent checks words a channel could not vouch for (DECISIONS.md#d-144). */
export const OWNER_CHECK = "owner-check";

/** A turn on the super-agent's answer to such words: it goes on with that chat's conversation, on its channel. */
export const answersChecked = (o: Origin | undefined): boolean =>
  o?.kind === "delegation_result" && o.session === OWNER_CHECK;

/** A file or image the owner attached to the message that started the run. */
export type Attachment = { media_id: string; kind: "image" | "audio" | "file"; mime: string; name: string };
export type RunInput = {
  origin: Origin;
  text: string;
  attachments?: Attachment[];
  /** The executing turn's project context, independent of later chat moves. */
  project_at_start?: { id: string; name: string };
  /** The turn's destination; null means the app. Kept across waits and restarts. */
  reply_to?: ThreadContext["reply_to"] | null;
  /** This run picks up the turn a restart of APX cut off (that run's id); such a run is never resumed again. */
  resume_of?: string;
  /** A delegated run APX started to go on with one a limit cut short (that run's id); never continued again. */
  continues?: string;
  /** A result turn that gave no answer, tried once more (that run's id); never retried again. */
  retry_of?: string;
};
export type RunRecord = Run & { input?: RunInput; message_id?: string };

export const TERMINAL: ReadonlySet<RunState> = new Set(["completed", "failed", "canceled"]);

const toRun = (r: Selectable<RunsTable>): RunRecord => ({
  id: r.id,
  thread_id: r.thread_id,
  agent_id: r.agent_id,
  state: r.state as RunState,
  trigger: r.trigger as RunTrigger,
  ...opt("parent_run_id", r.parent_run_id),
  depth: Number(r.depth),
  ...opt("deadline_at", r.deadline_at),
  ...(r.harness ? { harness: r.harness as HarnessId } : {}),
  ...opt("model", r.model),
  ...opt("error", r.error),
  ...(r.end_reason ? { end_reason: r.end_reason as RunEndReason } : {}),
  ...opt("resets_at", r.resets_at),
  started_at: r.started_at,
  ...opt("ended_at", r.ended_at),
  ...(r.usage ? { usage: JSON.parse(r.usage) as NonNullable<Run["usage"]> } : {}),
  tool_calls: Number(r.tool_calls),
  ...opt("activity", r.activity),
  ...(r.input ? { input: JSON.parse(r.input) as RunInput } : {}),
  ...opt("message_id", r.message_id),
});

/** The shape clients get: input and bookkeeping stay in the core. */
export const publicRun = ({ input: _i, message_id: _m, ...r }: RunRecord): Run => r;

export type StepState = "running" | "ok" | "error" | "unknown" | "skipped";
export type Step = {
  call_id: string;
  tool: string;
  args: Record<string, unknown>;
  effect: string;
  state: StepState;
  result: string | undefined;
};

/** A tool call found by search, with the run that made it. */
export type StepHit = {
  run_id: string;
  thread_id: string;
  agent_id: string;
  tool: string;
  args: string;
  state: StepState;
  result: string | undefined;
  started_at: string;
};

const LIVE = ["queued", "submitted", "working", "input-required"] as const;
/** What holds one of a thread's delegation slots: waiting for the owner does not (DECISIONS.md#d-096). */
const AT_WORK = ["submitted", "working"] as const;

/**
 * Fresh tokens a run spent: its input less what the provider read from its cache, plus its output. Every model call
 * of a turn sends the whole conversation again, mostly cached, so counting that would charge it once per call. A run
 * without usage counts as zero.
 */
const runTokens = raw<number>`max(coalesce(json_extract(usage, '$.input'), 0) - coalesce(json_extract(usage, '$.cached'), 0), 0) + coalesce(json_extract(usage, '$.output'), 0)`;

export function runsRepo({ one, all, run }: Sql, bus: Bus) {
  const emit = (r: RunRecord) => bus.emit({ type: "run.updated", run: publicRun(r) });
  const repo = {
    get(id: string): RunRecord | undefined {
      const r = one(qb.selectFrom("runs").selectAll().where("id", "=", id));
      return r ? toRun(r) : undefined;
    },
    list(threadId: string, limit = 20): RunRecord[] {
      return all(
        qb.selectFrom("runs").selectAll().where("thread_id", "=", threadId).orderBy("created_at", "desc").limit(limit),
      ).map(toRun);
    },
    /** Memory jobs can run long after their turn; select before the anchor, not from the newest chat page. */
    memoryWindow(anchor: RunRecord): RunRecord[] {
      return all(
        qb
          .selectFrom("runs")
          .selectAll()
          .where("thread_id", "=", anchor.thread_id)
          .where("agent_id", "=", anchor.agent_id)
          .where("state", "=", "completed")
          .where("started_at", "<=", anchor.started_at)
          .where(raw<boolean>`rowid <= (SELECT rowid FROM runs WHERE id = ${anchor.id})`)
          .where(raw<boolean>`(json_extract(input, '$.origin.kind') = 'user' OR
          (json_extract(input, '$.origin.kind') = 'channel' AND json_extract(input, '$.origin.role') = 'owner'))`)
          .orderBy("started_at", "desc")
          .orderBy("created_at", "desc")
          .orderBy(raw`rowid`, "desc")
          .limit(3),
      ).map(toRun);
    },
    /** An agent's runs, newest first; `before` pages back by creation time. */
    byAgent(agentId: string, limit: number, before?: string): RunRecord[] {
      return all(
        qb
          .selectFrom("runs")
          .selectAll()
          .where("agent_id", "=", agentId)
          .$if(before !== undefined, (q) => q.where("created_at", "<", before as string))
          .orderBy("created_at", "desc")
          .limit(limit),
      ).map(toRun);
    },
    create(r: {
      thread_id: string;
      agent_id: string;
      trigger: RunTrigger;
      input: RunInput;
      parent_run_id?: string | undefined;
      depth?: number;
      deadline_at: string;
      /** `queued`: a delegation that waits for a slot; the engine never picks it up until it is released. */
      state?: "submitted" | "queued";
    }): RunRecord {
      const id = newId("run");
      const ts = now();
      const input: RunInput = { ...r.input, project_at_start: undefined };
      run(
        qb.insertInto("runs").values({
          id,
          thread_id: r.thread_id,
          agent_id: r.agent_id,
          state: r.state ?? "submitted",
          trigger: r.trigger,
          input: JSON.stringify(input),
          parent_run_id: r.parent_run_id ?? null,
          depth: r.depth ?? 0,
          deadline_at: r.deadline_at,
          started_at: ts,
          created_at: ts,
        }),
      );
      const created = repo.get(id) as RunRecord;
      emit(created);
      return created;
    },
    /** Called with the same project selection as the executing turn, before its first await. */
    captureProject(id: string, projectId: string | undefined): void {
      const cur = repo.get(id);
      if (!cur?.input) return;
      const project = projectId
        ? one(qb.selectFrom("projects").select(["id", "name"]).where("id", "=", projectId))
        : undefined;
      const input: RunInput = {
        ...cur.input,
        project_at_start: project ? { id: project.id, name: project.name } : undefined,
      };
      run(
        qb
          .updateTable("runs")
          .set({ input: JSON.stringify(input) })
          .where("id", "=", id),
      );
    },
    /** Oldest admitted run of the thread that has not started. */
    nextQueued(threadId: string): RunRecord | undefined {
      const r = one(
        qb
          .selectFrom("runs")
          .selectAll()
          .where("thread_id", "=", threadId)
          .where("state", "=", "submitted")
          .orderBy("created_at")
          .orderBy(raw`rowid`)
          .limit(1),
      );
      return r ? toRun(r) : undefined;
    },
    queuedThreads(): string[] {
      return all(qb.selectFrom("runs").select("thread_id").distinct().where("state", "=", "submitted")).map(
        (r) => r.thread_id,
      );
    },
    /** The thread's runs that have not started, delegations waiting for a slot included. */
    queuedIds(threadId: string): string[] {
      return all(
        qb
          .selectFrom("runs")
          .select("id")
          .where("thread_id", "=", threadId)
          .where("state", "in", ["submitted", "queued"]),
      ).map((r) => r.id);
    },
    /** The delegations from this thread waiting for a slot, oldest first. */
    held(parentThreadId: string): RunRecord[] {
      return all(
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .selectAll("r")
          .where("t.parent_id", "=", parentThreadId)
          .where("r.state", "=", "queued")
          .orderBy("r.created_at")
          .orderBy(raw`r.rowid`),
      ).map(toRun);
    },
    /** Threads with delegations waiting for a slot. */
    heldParents(): string[] {
      return all(
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .select("t.parent_id")
          .distinct()
          .where("r.state", "=", "queued"),
      ).flatMap((r) => (r.parent_id ? [r.parent_id] : []));
    },
    /** Runs a crash or restart left mid-turn. */
    interrupted(): RunRecord[] {
      return all(qb.selectFrom("runs").selectAll().where("state", "in", ["working", "input-required"])).map(toRun);
    },
    children(runId: string): RunRecord[] {
      return all(qb.selectFrom("runs").selectAll().where("parent_run_id", "=", runId)).map(toRun);
    },
    /**
     * Turns agents started on their own (delegations, results waking callers) in these threads since the owner last
     * wrote (`since`: in the app, or on a channel as the owner, never as a contact), or since `after` when later;
     * only `agentId`'s turns when given.
     */
    unattended(threadIds: string[], after?: string, agentId?: string): { runs: number; tokens: number; since: string } {
      if (!threadIds.length) return { runs: 0, tokens: 0, since: "" };
      const last = one(
        qb
          .selectFrom("runs")
          .select((eb) => eb.fn.max("created_at").as("at"))
          .where("thread_id", "in", threadIds)
          .where((eb) =>
            eb.or([
              eb("trigger", "=", "user"),
              eb.and([eb("trigger", "=", "channel"), eb(raw`json_extract(input, '$.origin.role')`, "=", "owner")]),
            ]),
          ),
      );
      const r = one(
        qb
          .selectFrom("runs")
          .select((eb) => [eb.fn.countAll<number>().as("n"), raw<number>`coalesce(sum(${runTokens}), 0)`.as("t")])
          .where("thread_id", "in", threadIds)
          .where("trigger", "in", ["a2a", "a2a_result", "system"])
          // A queued delegation counts once it starts, when the breaker is checked again.
          .where("state", "!=", "queued")
          .$if(agentId !== undefined, (q) => q.where("agent_id", "=", agentId ?? ""))
          .where("created_at", ">", [String(last?.at ?? ""), after ?? ""].sort().at(-1) ?? ""),
      );
      return { runs: Number(r?.n ?? 0), tokens: Number(r?.t ?? 0), since: String(last?.at ?? "") };
    },
    /** Turns and tokens by model since `since` (optionally in one project's threads). */
    /** Tokens and turns by model since `since`: of a project, of one chat, or of several chats (a task's). */
    usage(
      since: string,
      projectId?: string,
      threadId?: string | string[],
    ): Array<{ model: string; harness: string; runs: number; input: number; output: number }> {
      const threads = threadId === undefined ? undefined : [threadId].flat();
      if (threads && !threads.length) return [];
      const rows = all(
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .select((eb) => [
            "r.model as model",
            "r.harness as harness",
            eb.fn.countAll<number>().as("n"),
            raw<number>`coalesce(sum(json_extract(r.usage, '$.input')), 0)`.as("i"),
            raw<number>`coalesce(sum(json_extract(r.usage, '$.output')), 0)`.as("o"),
          ])
          .where("r.model", "is not", null)
          .where("r.started_at", ">=", since)
          .$if(!!projectId, (q) => q.where("t.project_id", "=", projectId as string))
          .$if(!!threads, (q) => q.where("r.thread_id", "in", threads as string[]))
          .groupBy(["r.model", "r.harness"])
          .orderBy("n", "desc"),
      );
      return rows.map((r) => ({
        model: String(r.model),
        harness: String(r.harness ?? "native"),
        runs: Number(r.n),
        input: Number(r.i),
        output: Number(r.o),
      }));
    },
    /** Every run of one chat, however many the apps loaded: count, failures, seconds at work and tokens. */
    threadTotals(threadId: string): {
      runs: number;
      failed: number;
      seconds: number;
      input: number;
      output: number;
      cached: number;
    } {
      const r = one(
        qb
          .selectFrom("runs")
          .select((eb) => [
            eb.fn.countAll<number>().as("n"),
            raw<number>`coalesce(sum(state = 'failed'), 0)`.as("f"),
            raw<number>`coalesce(sum((julianday(ended_at) - julianday(started_at)) * 86400), 0)`.as("s"),
            raw<number>`coalesce(sum(json_extract(usage, '$.input')), 0)`.as("i"),
            raw<number>`coalesce(sum(json_extract(usage, '$.output')), 0)`.as("o"),
            raw<number>`coalesce(sum(json_extract(usage, '$.cached')), 0)`.as("c"),
          ])
          .where("thread_id", "=", threadId),
      );
      return {
        runs: Number(r?.n ?? 0),
        failed: Number(r?.f ?? 0),
        seconds: Math.round(Number(r?.s ?? 0) * 10) / 10,
        input: Number(r?.i ?? 0),
        output: Number(r?.o ?? 0),
        cached: Number(r?.c ?? 0),
      };
    },
    /** Runs in this thread's sub-threads admitted or at work (not those queued or waiting for the owner). */
    activeDelegations(parentThreadId: string): number {
      const r = one(
        qb
          .selectFrom("runs as r")
          .innerJoin("threads as t", "t.id", "r.thread_id")
          .select((eb) => eb.fn.countAll<number>().as("n"))
          .where("t.parent_id", "=", parentThreadId)
          .where("r.state", "in", AT_WORK),
      );
      return Number(r?.n ?? 0);
    },
    setReplyTo(id: string, replyTo: RunInput["reply_to"]): void {
      const input = repo.get(id)?.input;
      if (input)
        run(
          qb
            .updateTable("runs")
            .set({ input: JSON.stringify({ ...input, reply_to: replyTo ?? null }) })
            .where("id", "=", id),
        );
    },
    /** Moves a working run's deadline (an engine session's, while it keeps working). */
    setDeadline(id: string, at: string): void {
      run(qb.updateTable("runs").set({ deadline_at: at }).where("id", "=", id).where("ended_at", "is", null));
    },
    /** `end`: why it ended, when known (and when a provider limit lifts). */
    setState(
      cur: RunRecord,
      state: RunState,
      error?: string,
      end?: { reason: RunEndReason; resets_at?: string | undefined },
    ): RunRecord {
      const terminal = TERMINAL.has(state);
      const base = repo.get(cur.id) ?? cur;
      const next: RunRecord = {
        ...base,
        // Ended runs are doing nothing.
        ...(terminal ? { activity: undefined } : {}),
        state,
        ...(error ? { error } : {}),
        ...(end ? { end_reason: end.reason, ...(end.resets_at ? { resets_at: end.resets_at } : {}) } : {}),
        ...(state === "working" && base.state === "submitted" ? { started_at: now() } : {}),
        ...(terminal ? { ended_at: now() } : {}),
      };
      run(
        qb
          .updateTable("runs")
          .set({
            state,
            error: next.error ?? null,
            started_at: next.started_at,
            ended_at: next.ended_at ?? null,
            activity: next.activity ?? null,
            end_reason: next.end_reason ?? null,
            resets_at: next.resets_at ?? null,
          })
          .where("id", "=", cur.id),
      );
      emit(next);
      return next;
    },
    patch(
      cur: RunRecord,
      p: { harness?: HarnessId; model?: string; message_id?: string; usage?: NonNullable<Run["usage"]> },
    ): RunRecord {
      // From the stored row: activity counters change underneath the turn's own copy.
      const next: RunRecord = { ...(repo.get(cur.id) ?? cur), ...p };
      run(
        qb
          .updateTable("runs")
          .set({
            harness: next.harness ?? null,
            model: next.model ?? null,
            message_id: next.message_id ?? null,
            usage: next.usage ? JSON.stringify(next.usage) : null,
          })
          .where("id", "=", cur.id),
      );
      emit(next);
      return next;
    },

    /** What the run is doing now; `tool` counts one more tool call. Cleared when the run ends. */
    setActivity(runId: string, activity: string | undefined, tool = false): void {
      run(
        qb
          .updateTable("runs")
          .set((eb) => ({ activity: activity ?? null, tool_calls: eb("tool_calls", "+", tool ? 1 : 0) }))
          .where("id", "=", runId),
      );
      const cur = repo.get(runId);
      if (cur) emit(cur);
    },
    /** Running work and the latest finished background work (delegations, wakes, routines; not plain chat turns). */
    jobs(finished: number): { running: RunRecord[]; finished: RunRecord[] } {
      return {
        running: all(
          qb.selectFrom("runs as r").selectAll("r").where("r.state", "in", LIVE).orderBy("r.created_at", "desc"),
        ).map(toRun),
        finished: all(
          qb
            .selectFrom("runs as r")
            .innerJoin("threads as t", "t.id", "r.thread_id")
            .selectAll("r")
            .where("r.state", "in", [...TERMINAL])
            .where((eb) => eb.or([eb("r.trigger", "!=", "user"), eb("t.parent_id", "is not", null)]))
            .orderBy("r.ended_at", "desc")
            .limit(finished),
        ).map(toRun),
      };
    },

    // ── steps ──────────────────────────────────────────────────────────
    /** Written before the tool runs (recovery reads it). Returns the step id. */
    beginStep(
      runId: string,
      s: { call_id: string; tool: string; args: Record<string, unknown>; effect: string },
    ): string {
      const next = one(
        qb
          .selectFrom("steps")
          .select((eb) => eb(eb.fn.coalesce(eb.fn.max("seq"), eb.lit(0)), "+", 1).as("n"))
          .where("run_id", "=", runId),
      );
      const seq = Number(next?.n ?? 1);
      const id = newId("stp");
      run(
        qb.replaceInto("steps").values({
          id,
          run_id: runId,
          seq,
          call_id: s.call_id,
          tool: s.tool,
          args: JSON.stringify(s.args),
          effect: s.effect,
          state: "running",
          started_at: now(),
        }),
      );
      return id;
    },
    /** `result` is the short form shown in recovery notes; `output` the whole text, kept for read_output. */
    endStep(runId: string, callId: string, state: StepState, result: string, output?: string): void {
      run(
        qb
          .updateTable("steps")
          .set({ state, result, output: output ?? null, ended_at: now() })
          .where("run_id", "=", runId)
          .where("call_id", "=", callId),
      );
    },
    /** A step's full output, only from a run of the given thread (an agent reads its own thread's outputs). */
    output(stepId: string, threadId: string): string | undefined {
      const r = one(
        qb
          .selectFrom("steps as s")
          .innerJoin("runs as r", "r.id", "s.run_id")
          .select("s.output")
          .where("s.id", "=", stepId)
          .where("r.thread_id", "=", threadId),
      );
      return r?.output == null ? undefined : r.output;
    },
    /**
     * Tool calls in these threads whose tool or arguments hold every word, newest first. Results are outside text.
     * `excludeRuns` (already in a model's view) are dropped before the limit.
     */
    searchSteps(words: string[], threadIds: string[], limit = 10, excludeRuns: string[] = []): StepHit[] {
      if (!words.length || !threadIds.length) return [];
      const haystack = raw<string>`s.tool || ' ' || s.args`;
      const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return all(
        qb
          .selectFrom("steps as s")
          .innerJoin("runs as r", "r.id", "s.run_id")
          .select(["s.run_id", "r.thread_id", "r.agent_id", "s.tool", "s.args", "s.state", "s.result", "s.started_at"])
          .where("r.thread_id", "in", threadIds)
          .$if(excludeRuns.length > 0, (q) => q.where("s.run_id", "not in", excludeRuns))
          .where((eb) => eb.and(words.map((w) => raw<boolean>`${haystack} like ${like(w)} escape '\\'`)))
          .orderBy("s.started_at", "desc")
          .limit(limit),
      ).map((r) => ({ ...r, state: r.state as StepState, result: r.result ?? undefined }));
    },
    steps(runId: string): Step[] {
      return all(qb.selectFrom("steps").selectAll().where("run_id", "=", runId).orderBy("seq")).map((r) => ({
        call_id: r.call_id,
        tool: r.tool,
        args: JSON.parse(r.args) as Record<string, unknown>,
        effect: r.effect,
        state: r.state as StepState,
        result: r.result == null ? undefined : r.result,
      }));
    },
  };
  return repo;
}
