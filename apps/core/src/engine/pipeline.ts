// A routine's commands around its agent: the pre-command runs first and its output reaches the prompt as outside
// data; whether the model is called depends on that result; the post-command runs after with what came out. The
// owner writes the commands (routines.set is human-only); they run in the project's folder with a deadline, a capped
// output and no credentials in their environment.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CallModel, Routine } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { commandEnv } from "../harness/env.ts";
import { untrusted } from "../tools/result.ts";
import type { Display } from "./display.ts";

/** A step runs at most this long (and never past its run's own deadline). */
export const STEP_TIMEOUT_MS = 120_000;
/** The end of a step's output that is kept: the prompt, the environment and the transcript get at most this. */
export const STEP_OUTPUT_CHARS = 8000;
/** Where the owner's prompt takes the pre-command's output; without it, the output goes after the prompt. */
const PRE_SLOT = "{{pre_output}}";

export type StepResult = { output: string; exit: number | null; timedOut: boolean };

/** Runs one owner command with sh in `cwd`; resolves with its (tail-capped) output whatever happens. */
export function runStep(
  command: string,
  o: { cwd: string; env: Record<string, string>; signal: AbortSignal; timeoutMs?: number },
): Promise<StepResult> {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: o.cwd,
      env: o.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-STEP_OUTPUT_CHARS * 2);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // Its own process group: stopping it also stops what it started.
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, o.timeoutMs ?? STEP_TIMEOUT_MS);
    o.signal.addEventListener("abort", stop, { once: true });
    const done = (exit: number | null, extra = "") => {
      clearTimeout(timer);
      o.signal.removeEventListener("abort", stop);
      resolve({ output: (out + extra).slice(-STEP_OUTPUT_CHARS), exit, timedOut });
    };
    child.on("error", (err) => done(null, `\n${err.message}`));
    child.on("close", (code) => done(code));
  });
}

/** Whether the model is called, from the pre-command's result. */
export function callsModel(mode: CallModel, pre: StepResult): boolean {
  if (mode === "never") return false;
  if (mode === "output") return pre.output.trim() !== "";
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
  return prompt.includes(PRE_SLOT) ? prompt.split(PRE_SLOT).join(block) : `${prompt}\n\n${block}`;
}

const label = (r: StepResult) => (r.timedOut ? "timed out" : r.exit === 0 ? "ok" : `exit ${r.exit ?? "?"}`);

/** The routine behind a run, when it is a routine's run with commands of its own. */
export function routineWithCommands(store: Store, run: RunRecord): Routine | undefined {
  const origin = run.input?.origin;
  if (run.trigger !== "routine" || origin?.kind !== "routine") return undefined;
  const r = store.routines.get(origin.id);
  return r && (r.pre_command || r.post_command) ? r : undefined;
}

/** One routine run's pipeline: the pre-step before the turn and the post-step after it, shown in the run's message. */
export function routinePipeline(o: { store: Store; home: string; routine: Routine; run: RunRecord; display: Display }) {
  const { routine, display } = o;
  const project = routine.project_id ? o.store.projects.get(routine.project_id) : undefined;
  const cwd = project?.path && project.present ? project.path : path.join(o.home, "work");
  let pre: StepResult | undefined;

  const step = async (code: string, command: string, env: Record<string, string>, signal: AbortSignal) => {
    fs.mkdirSync(cwd, { recursive: true });
    const r = await runStep(command, { cwd, env: { ...commandEnv(), ...env }, signal });
    const tail = r.output.trim().split("\n").slice(-12).join("\n");
    display.notice(
      r.exit === 0 && !r.timedOut ? "info" : "warn",
      code,
      `${code === "routine.pre" ? "Pre-command" : "Post-command"}: ${label(r)}${tail ? `\n${tail}` : ""}`,
    );
    return r;
  };

  return {
    /** Runs the pre-command (if any); says whether the model should be called. */
    async before(signal: AbortSignal): Promise<{ call: boolean; prompt: (text: string) => string }> {
      if (!routine.pre_command) return { call: true, prompt: (t) => t };
      pre = await step("routine.pre", routine.pre_command, {}, signal);
      const result = pre;
      const call = callsModel(routine.call_model, result);
      o.store.routines.modelCalled(o.run.id, call);
      return { call, prompt: (t) => withPreOutput(t, result) };
    },
    /** Runs the post-command (if any) with what the run produced. */
    async after(done: RunRecord, skipped: boolean): Promise<void> {
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
        AbortSignal.timeout(STEP_TIMEOUT_MS),
      );
    },
  };
}
