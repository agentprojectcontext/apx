// A routine's commands around its agent: the pre-command runs first and its output reaches the prompt as outside
// data; whether the model is called depends on that result; the post-command runs after with what came out. The
// owner writes the commands (routines.set is human-only); they run in the project's folder with a deadline, a capped
// output and no credentials in their environment.
import fs from "node:fs";
import path from "node:path";
import type { CallModel, Routine } from "@apx/protocol";
import { inQuietHours, noticePrefs } from "../domain/notices.ts";
import type { RunRecord } from "../domain/runs.ts";
import { freshSignals, signalLines, watchSignals } from "../domain/signals.ts";
import type { Store } from "../domain/store.ts";
import { commandEnv } from "../harness/env.ts";
import { MAX_STEPS } from "../harness/native.ts";
import { spawnCommand, stopTree } from "../processes.ts";
import { workDir } from "../tools/folders.ts";
import { untrusted } from "../tools/result.ts";
import type { Display } from "./display.ts";
import { takeTeamNews } from "./team-news.ts";

/** A step runs at most this long (and never past its run's own deadline). */
export const STEP_TIMEOUT_MS = 120_000;
/** The post-command's limit when the run already missed its deadline. */
export const POST_AFTER_DEADLINE_MS = 15_000;
/** The end of a step's output that is kept: the prompt, the environment and the transcript get at most this. */
export const STEP_OUTPUT_CHARS = 8000;
/** Where the owner's prompt takes the pre-command's output (its first one); without it, after the prompt. */
const PRE_SLOT = "{{pre_output}}";

export type StepResult = { output: string; exit: number | null; timedOut: boolean };

/** A mail as a mail routine sees it: who, what, and Gmail's labels (IMPORTANT, CATEGORY_PROMOTIONS…). */
export type MailArrival = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
};

/** The owner's Gmail for a mail routine; `readable` is false while it cannot be read (not connected, send-only). */
export type MailSource = {
  readable(project: string | undefined): boolean;
  historyId(): Promise<string>;
  /** What reached the inbox after `from`, and where to ask from next; undefined when that point is too old. */
  arrived(from: string): Promise<{ next: string; mail: MailArrival[] } | undefined>;
};

/** Gmail's tabs a mail routine never reads: ads, social networks, mailing lists, spam. */
const UNREAD_TABS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM", "TRASH", "SENT"]);

/** The mail worth a look, one line each, for the routine's agent to judge. */
export function mailLines(mail: MailArrival[]): string {
  return mail
    .map((m) =>
      JSON.stringify({
        id: m.id,
        from: m.from,
        subject: m.subject,
        date: m.date,
        snippet: m.snippet.slice(0, 300),
        ...(m.labels.includes("IMPORTANT") ? { gmail_important: true } : {}),
      }),
    )
    .join("\n");
}

/** Runs one owner command in this system's shell in `cwd`; resolves with its (tail-capped) output whatever happens. */
export function runStep(
  command: string,
  o: { cwd: string; env: Record<string, string>; signal: AbortSignal; timeoutMs?: number },
): Promise<StepResult> {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let settled = false;
    // A NUL cannot travel in an environment variable (spawn would throw): it is dropped.
    const env = Object.fromEntries(Object.entries(o.env).map(([k, v]) => [k, v.replaceAll("\0", "")]));
    const done = (exit: number | null, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal.removeEventListener("abort", stop);
      resolve({ output: (out + extra).slice(-STEP_OUTPUT_CHARS), exit, timedOut });
    };
    let child: ReturnType<typeof spawnCommand>;
    try {
      child = spawnCommand(command, { cwd: o.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ output: err instanceof Error ? err.message : String(err), exit: null, timedOut: false });
      return;
    }
    const keep = (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-STEP_OUTPUT_CHARS * 2);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    // Its own process group: stopping it also stops what it started. Something that left the group (setsid) may
    // still hold the pipes, so the step ends now instead of waiting for them to close.
    function stop() {
      if (child.pid) stopTree(child.pid, { graceMs: 0 });
      child.stdout?.destroy();
      child.stderr?.destroy();
      done(null, timedOut ? "\n[stopped: time limit]" : "\n[stopped]");
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, o.timeoutMs ?? STEP_TIMEOUT_MS);
    if (o.signal.aborted) stop();
    else o.signal.addEventListener("abort", stop, { once: true });
    child.on("error", (err) => done(null, `\n${err.message}`));
    child.on("close", (code) => done(code));
  });
}

/** Whether the model is called, from the pre-command's result. */
export function callsModel(mode: CallModel, pre: StepResult): boolean {
  if (mode === "never") return false;
  if (mode === "output") return pre.output.trim() !== "";
  if (mode === "succeeds") return pre.exit === 0;
  if (mode === "fails") return pre.exit !== 0;
  return true;
}

/** The owner's prompt with the pre-command's output in its slot (or after it), marked as outside data. */
export function withPreOutput(prompt: string, pre: StepResult): string {
  const block = untrusted(
    "pre_output",
    { exit: String(pre.exit ?? "none"), ...(pre.timedOut ? { timed_out: "yes" } : {}) },
    pre.output || "(no output)",
  );
  // The first slot only: the output goes into the prompt once, however many times the slot is written.
  const at = prompt.indexOf(PRE_SLOT);
  return at < 0 ? `${prompt}\n\n${block}` : `${prompt.slice(0, at)}${block}${prompt.slice(at + PRE_SLOT.length)}`;
}

const label = (r: StepResult) => (r.timedOut ? "timed out" : r.exit === 0 ? "ok" : `exit ${r.exit ?? "?"}`);

/** The routine behind a run, when it needs the pipeline: commands of its own, or an action other than its agent. */
export function routineWithCommands(store: Store, run: RunRecord): Routine | undefined {
  const origin = run.input?.origin;
  if (run.trigger !== "routine" || origin?.kind !== "routine") return undefined;
  const r = store.routines.get(origin.id);
  return r && (r.pre_command || r.post_command || r.action !== "agent") ? r : undefined;
}

/** How many model calls a run may make on our own loop: its routine's own limit, else the default. */
export function stepsFor(store: Store, run: RunRecord): number {
  const origin = run.input?.origin;
  const own =
    run.trigger === "routine" && origin?.kind === "routine" ? store.routines.get(origin.id)?.max_steps : undefined;
  return own ?? MAX_STEPS;
}

/** A message routine's text: the owner's words with the pre-command's output, as it is, in its slot. */
export function messageText(text: string, pre: StepResult | undefined): string {
  const out = pre?.output.trim() ?? "";
  return text.includes(PRE_SLOT) ? text.replace(PRE_SLOT, out) : text;
}

/** One routine run's pipeline: the pre-step before the turn and the post-step after it, shown in the run's message. */
export function routinePipeline(o: {
  store: Store;
  home: string;
  routine: Routine;
  run: RunRecord;
  display: Display;
  mail?: MailSource | undefined;
}) {
  const { routine, display } = o;
  // The commands run where the routine's agent works in its chat.
  const thread = o.store.threads.get(o.run.thread_id);
  const cwd = thread ? workDir(o.store, o.home, thread) : path.join(o.home, "work");
  let pre: StepResult | undefined;

  const step = async (code: string, command: string, env: Record<string, string>, signal: AbortSignal) => {
    fs.mkdirSync(cwd, { recursive: true });
    const r = await runStep(command, { cwd, env: { ...commandEnv(), ...env }, signal });
    const tail = r.output.trim().split("\n").slice(-12).join("\n");
    const status = r.timedOut ? "timeout" : r.exit === 0 ? "ok" : "failed";
    display.notice(
      status === "ok" ? "info" : "warn",
      `${code}.${status}`,
      `${code === "routine.pre" ? "Pre-command" : "Post-command"}: ${label(r)}`,
      { vars: { exit: r.exit ?? "?" }, ...(tail ? { detail: tail } : {}) },
    );
    return r;
  };

  /**
   * A watch: its agent is called only with signals not told lately; they reach it as data, not instructions. In the
   * owner's quiet hours it waits (nothing it says would reach them): the first run after sees what is new.
   */
  const watch = (result: StepResult | undefined) => {
    const now = new Date();
    if (inQuietHours(noticePrefs(o.store), now)) {
      o.store.routines.modelCalled(o.run.id, false);
      return { call: false, prompt: (t: string) => t };
    }
    const key = `watch_seen:${routine.id}`;
    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(o.store.settings.get(key) ?? "{}") as Record<string, string>;
    } catch {}
    const all = watchSignals(o.store, { projectId: routine.project_id, now });
    const next = freshSignals(all, seen, now);
    o.store.settings.set(key, JSON.stringify(next.seen));
    o.store.routines.modelCalled(o.run.id, next.fresh.length > 0);
    if (!next.fresh.length) return { call: false, prompt: (t: string) => t };
    const block = untrusted("signals", { count: String(next.fresh.length) }, signalLines(next.fresh));
    return {
      call: true,
      prompt: (t: string) => `${result ? withPreOutput(t, result) : t}\n\n${block}`,
    };
  };

  /**
   * A relay: its agent is called only when other agents' news waits for it; the news reaches it as data, not
   * instructions. In the owner's quiet hours it waits, like a watch: the first run after tells all of it.
   */
  const relay = (result: StepResult | undefined) => {
    const news = inQuietHours(noticePrefs(o.store), new Date()) ? undefined : takeTeamNews(o.store);
    o.store.routines.modelCalled(o.run.id, Boolean(news));
    if (!news) return { call: false, prompt: (t: string) => t };
    const block = untrusted("team_news", { count: String(news.count) }, news.lines);
    return {
      call: true,
      prompt: (t: string) => `${result ? withPreOutput(t, result) : t}\n\n${block}`,
    };
  };

  /**
   * A mail routine: its agent is called only when mail outside Gmail's ads, social and lists tabs reached the inbox
   * since the last run; it reaches the agent as data. The first run starts from now; in the owner's quiet hours it
   * waits, and the first run after sees what came.
   */
  const mail = async (result: StepResult | undefined) => {
    const none = { call: false, prompt: (t: string) => t };
    const source = o.mail;
    if (!source?.readable(routine.project_id) || inQuietHours(noticePrefs(o.store), new Date())) {
      o.store.routines.modelCalled(o.run.id, false);
      return none;
    }
    const key = `mail_seen:${routine.id}`;
    try {
      const from = o.store.settings.get(key);
      const got = from ? await source.arrived(from) : undefined;
      o.store.settings.set(key, got ? got.next : await source.historyId());
      const worth = (got?.mail ?? []).filter((m) => !m.labels.some((l) => UNREAD_TABS.has(l)));
      o.store.routines.modelCalled(o.run.id, worth.length > 0);
      if (!worth.length) return none;
      const block = untrusted("emails", { count: String(worth.length) }, mailLines(worth));
      return { call: true, prompt: (t: string) => `${result ? withPreOutput(t, result) : t}\n\n${block}` };
    } catch (err) {
      // Gmail did not answer: nothing is lost, the next run asks from the same point.
      display.notice("warn", "routine.mail", `Gmail: ${err instanceof Error ? err.message : String(err)}`);
      o.store.routines.modelCalled(o.run.id, false);
      return none;
    }
  };

  return {
    /**
     * Runs the pre-command (if any) and says what comes next: the model (an agent routine), a message to send as it is
     * (a message routine, when its condition holds), or nothing more (a shell routine, or a condition that said no).
     */
    async before(signal: AbortSignal): Promise<{ call: boolean; message?: string; prompt: (text: string) => string }> {
      if (routine.pre_command) pre = await step("routine.pre", routine.pre_command, {}, signal);
      const result = pre;
      if (routine.action === "watch") return watch(result);
      if (routine.action === "relay") return relay(result);
      if (routine.action === "mail") return mail(result);
      const goOn = result ? callsModel(routine.call_model, result) : true;
      if (routine.action !== "agent") {
        o.store.routines.modelCalled(o.run.id, false);
        const message = routine.action === "message" && goOn ? messageText(routine.prompt, result) : undefined;
        return { call: false, ...(message ? { message } : {}), prompt: (t) => t };
      }
      if (!result) return { call: true, prompt: (t) => t };
      o.store.routines.modelCalled(o.run.id, goOn);
      return { call: goOn, prompt: (t) => withPreOutput(t, result) };
    },
    /** Runs the post-command (if any) with what the run produced; `limitMs` is shorter after a missed deadline. */
    async after(done: RunRecord, skipped: boolean, limitMs = STEP_TIMEOUT_MS): Promise<void> {
      if (!routine.post_command) return;
      const text = done.message_id
        ? (o.store.messages.get(done.message_id)?.parts ?? [])
            .flatMap((p) => (p.type === "text" ? [p.text] : []))
            .join("\n")
        : "";
      await step(
        "routine.post",
        routine.post_command,
        {
          APX_LLM_OUTPUT: text.slice(-STEP_OUTPUT_CHARS),
          APX_STATUS: skipped ? "skipped" : done.state,
          APX_SKIPPED: skipped ? "1" : "0",
          APX_PRE_OUTPUT: pre?.output ?? "",
          APX_PRE_EXIT: String(pre?.exit ?? ""),
        },
        AbortSignal.timeout(limitMs),
      );
    },
  };
}
