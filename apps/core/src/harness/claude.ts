// Claude Code in its own sessions: the owner's own `claude` (their login, CLAUDE.md and settings) through the Agent
// SDK; every APX tool call comes back through `io.execute`. See DECISIONS.md#d-007
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorMessage } from "../errors.ts";
import type { Usage } from "../providers/types.ts";
import { harnessEnv } from "./env.ts";
import { effortPart, type Harness, modelPart, type TurnIO, type TurnOutcome } from "./types.ts";

/**
 * Our tool specs are JSON Schema derived from each tool's zod schema; the Agent SDK wants a zod raw shape. Rebuilt
 * from the same schema (arrays, enums, limits included): a looser copy made Claude send arguments our check refuses.
 * See HISTORY.md#claude-tool-schema
 */
export function zodShape(params: object): z.ZodRawShape {
  const s = z.fromJSONSchema(params as Parameters<typeof z.fromJSONSchema>[0]);
  return s instanceof z.ZodObject ? s.shape : {};
}

// Claude Code's own web, file and shell tools, each asked through our policy. Its task list, subagents and questions
// are not offered: APX's plan, delegate and ask_owner do those, with their cards (DECISIONS.md#d-199).
const CLAUDE_BUILTINS = ["WebSearch", "WebFetch"];
const CODE_READ = ["Read", "Glob", "Grep", "LS"];
const CODE_WRITE = ["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"];
/** Claude Code's tool names as the protocol's tool kinds, for our policy. */
const KIND: Record<string, string> = {
  Read: "read",
  Glob: "search",
  Grep: "search",
  LS: "read",
  WebSearch: "fetch",
  WebFetch: "fetch",
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Bash: "execute",
};

/** What a Claude Code tool call is about, for its card and the owner's question. */
function subjectOf(input: Record<string, unknown>): string {
  return String(input.file_path ?? input.path ?? input.command ?? input.url ?? input.query ?? "");
}

/** Claude Code has no task list of its own here: its checklist is APX's plan, as our loop's is. */
export const PLAN_NOTE =
  "\n\nYour checklist here is mcp__apx__plan, shown to the owner under your answer: work of more than two steps starts with it, sent whole again as each step is done.";

/** The line that steers Claude Code to APX's plan, when the turn offers it. */
export const planNote = (io: Pick<TurnIO, "tools">) =>
  io.tools.some((t) => t.function.name === "plan") ? PLAN_NOTE : "";

const CLAUDE_MD_CAP = 12_000;

/**
 * The folder's CLAUDE.md, read by APX: the repo's own .claude/settings files are not loaded, since their allow rules
 * and hooks would skip APX's approval. A link is not followed (it could point at any file of the owner's).
 */
export function folderClaudeMd(cwd: string): string {
  const file = path.join(cwd, "CLAUDE.md");
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return "";
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return "";
    const body = text.length > CLAUDE_MD_CAP ? `${text.slice(0, CLAUDE_MD_CAP)}\n[… cut]` : text;
    return `\n\n# The folder's CLAUDE.md\n\n${body}`;
  } catch {
    return "";
  }
}

type Counts = { apx: number; builtins: number; permissions: number };

/** A model call's tokens as the Messages API reports them; cached prompt tokens are counted apart. */
type CallUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/**
 * Adds up a Claude Code turn's model calls, its subagents' included. The SDK repeats a call's usage on each of its
 * content blocks: each call counts once, its whole prompt (cached or not) as `input`.
 */
export function claudeUsage(report: (soFar: Usage) => void) {
  const calls = new Map<string, Usage>();
  let context: number | undefined;
  let window: number | undefined;
  const total = (): Usage => {
    const u: Usage = { input: 0, output: 0 };
    for (const c of calls.values()) {
      u.input += c.input;
      u.output += c.output;
      if (c.cached) u.cached = (u.cached ?? 0) + c.cached;
    }
    if (context) u.context = context;
    if (window) u.window = window;
    return u;
  };
  return {
    /** A call's tokens so far; `main` is the turn's own loop, whose latest call is how full the chat is. */
    call(id: string | undefined, u: CallUsage | null | undefined, main: boolean): void {
      if (!id || !u) return;
      const cached = u.cache_read_input_tokens ?? 0;
      const input = (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0);
      const prev = calls.get(id);
      const next: Usage = {
        input: Math.max(input, prev?.input ?? 0),
        output: Math.max(u.output_tokens ?? 0, prev?.output ?? 0),
      };
      const reused = Math.max(cached, prev?.cached ?? 0);
      if (reused) next.cached = reused;
      if (prev && prev.input === next.input && prev.output === next.output) return;
      calls.set(id, next);
      if (main && next.input) context = next.input;
      report(total());
    },
    /** The model's context limit, from the SDK's per-model totals when the turn ends. */
    window(n: number | undefined): void {
      if (n) window = n;
    },
    /** Every call so far, or nothing when none reported tokens. */
    total: (): Usage | undefined => (calls.size ? total() : undefined),
  };
}
type Tally = ReturnType<typeof claudeUsage>;

type Sdk = typeof import("@anthropic-ai/claude-agent-sdk");
type ImageReader = (id: string) => { mime: string; data: string } | undefined;

type UserMessage = import("@anthropic-ai/claude-agent-sdk").SDKUserMessage;

/** The turn's words and images, as the SDK takes a user message's content; words alone as text, as typed. */
function promptContent(io: TurnIO, readImage: ImageReader): UserMessage["message"]["content"] {
  if (!io.input.images?.length) return io.input.content;
  const content: UserMessage["message"]["content"] = [{ type: "text", text: io.input.content }];
  for (const image of io.input.images ?? []) {
    const stored = readImage(image.media_id);
    if (!stored) throw new Error(`Image attachment ${image.media_id} is no longer available`);
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(stored.mime))
      throw new Error(`Unsupported image attachment type: ${stored.mime}`);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: stored.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: stored.data,
      },
    });
  }
  return content;
}

/**
 * `priority`: "next" folds the words into the running turn after its tool round; "now" stops the step it is on and
 * runs them next, in the same session.
 */
function userMessage(
  io: TurnIO,
  content: UserMessage["message"]["content"],
  priority?: "next" | "now",
): UserMessage & { uuid: string } {
  return {
    type: "user",
    session_id: io.sessionId ?? "",
    message: { role: "user", content },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    ...(priority ? { priority } : {}),
  };
}

/** The query's input: the turn's prompt, then the owner's words as the turn takes them; it ends with the turn. */
function inputStream() {
  const queue: UserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const notify = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };
  return {
    push(m: UserMessage): void {
      queue.push(m);
      notify();
    },
    close(): void {
      closed = true;
      notify();
    },
    async *messages(): AsyncGenerator<UserMessage> {
      for (;;) {
        for (let m = queue.shift(); m; m = queue.shift()) yield m;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/**
 * The owner's words into a running query (DECISIONS.md#d-196): taken where Claude's tools run ("next", folded in after
 * the round) or at once on "send now" ("now"); the turn goes on until a result lists every one.
 */
function ownerWords(io: TurnIO, input: ReturnType<typeof inputStream>, beforeNow: () => void) {
  const unanswered = new Set<string>();
  let cut: AbortSignal | undefined;
  const take = (priority: "next" | "now") => {
    for (const words of io.takeSteered?.() ?? []) {
      const m = userMessage(io, words, priority);
      unanswered.add(m.uuid);
      input.push(m);
    }
  };
  const onCut = () => {
    beforeNow();
    take("now");
    listen();
  };
  const listen = () => {
    cut = io.stepSignal?.();
    cut?.addEventListener("abort", onCut, { once: true });
  };
  return {
    take,
    listen,
    /** What a result took; true while words handed over still wait. A CLI that lists none folded them all. */
    waiting(taken: string[] | undefined): boolean {
      if (taken) for (const id of taken) unanswered.delete(id);
      else unanswered.clear();
      return unanswered.size > 0;
    },
    stop: () => cut?.removeEventListener("abort", onCut),
  };
}

// The SDK is a large module: loaded on the first Claude turn, so a core that never runs one never pays for it.
let sdkLoad: Promise<Sdk> | undefined;
const loadSdk = () => {
  sdkLoad ??= import("@anthropic-ai/claude-agent-sdk");
  return sdkLoad;
};

/** APX's tools as an in-process MCP server: every call comes back through io.execute (cards, policy, steps). */
function apxServer({ createSdkMcpServer, tool }: Sdk, io: TurnIO, counts: Counts) {
  return createSdkMcpServer({
    name: "apx",
    version: "0.1.0",
    tools: io.tools.map((spec) =>
      tool(spec.function.name, spec.function.description, zodShape(spec.function.parameters), async (args) => {
        counts.apx++;
        const r = await io.execute(`${io.run.id}-c${counts.apx}`, spec.function.name, args as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok };
      }),
    ),
  });
}

/** Every built-in tool (reads included: they may reach outside the folder) asks our policy through canUseTool. */
function toolOptions(io: TurnIO, counts: Counts) {
  const ours = io.tools.map((s) => `mcp__apx__${s.function.name}`);
  return {
    tools: [...CLAUDE_BUILTINS, ...CODE_READ, ...CODE_WRITE],
    allowedTools: ours,
    permissionMode: "default" as const,
    canUseTool: async (name: string, input: Record<string, unknown>) => {
      const ok = await io.approve({
        callId: `${io.run.id}-p${++counts.permissions}`,
        title: `${name} ${subjectOf(input).slice(0, 200)}`.trim(),
        kind: KIND[name] ?? "other",
        detail: JSON.stringify(input, null, 1),
        input: { ...input, ...(input.file_path ? { path: input.file_path } : {}) },
      });
      return ok
        ? { behavior: "allow" as const, updatedInput: input }
        : { behavior: "deny" as const, message: "The owner's policy does not allow this here." };
    },
  };
}

/**
 * Runs one query and reads its stream: text as it comes, its own tools as cards, the result at the end. The owner's
 * words reach it mid-turn, as they reach our own loop (DECISIONS.md#d-196).
 */
async function attempt(
  io: TurnIO,
  o: {
    claudePath: string;
    cwd: (io: TurnIO) => string;
    chosen: string | undefined;
    effort: string | undefined;
    counts: Counts;
    tally: Tally;
    resume: string | undefined;
    readImage: ImageReader;
  },
): Promise<TurnOutcome> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  io.signal.addEventListener("abort", onAbort, { once: true });
  let text = "";
  // A finished answer before words the SDK ran right after it: kept above the next one.
  let prefix = "";
  // The turn's own model call is writing: a "send now" drops what it wrote so far.
  let streaming = false;
  let model = "default";
  let modelConfirmed = false;
  const reportModel = (reported: string | undefined) => {
    // Startup aliases do not identify the model that will actually answer.
    if (!reported || /^(default|opus|sonnet|haiku|opusplan)(\[.*\])?$/.test(reported) || reported === "<synthetic>")
      return;
    model = reported;
    modelConfirmed = true;
    io.onModel?.(`claude/${reported}`);
  };
  let sessionId = o.resume;
  // The call each stream is on (the turn's own, keyed "", and each subagent's), for the tokens its deltas add.
  const current = new Map<string, string>();
  const input = inputStream();
  // "Send now" drops the answer it is writing, as our own loop does.
  const words = ownerWords(io, input, () => {
    if (!streaming) return;
    text = "";
    io.onText(prefix);
  });
  try {
    input.push(userMessage(io, promptContent(io, o.readImage)));
    words.listen();
    const sdk = await loadSdk();
    const cwd = o.cwd(io);
    const q = sdk.query({
      prompt: input.messages(),
      options: {
        abortController: ac,
        pathToClaudeCodeExecutable: o.claudePath,
        cwd,
        // Claude Code itself: its own prompt and the owner's own CLAUDE.md and settings; the folder's settings are a
        // repo's word, not the owner's, so only its CLAUDE.md comes in. See DECISIONS.md#d-057
        systemPrompt: { type: "preset", preset: "claude_code", append: io.system + planNote(io) + folderClaudeMd(cwd) },
        ...toolOptions(io, o.counts),
        settingSources: ["user"],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true, syncClaudeAiSkills: false, syncClaudeAiPlugins: false },
        mcpServers: { apx: apxServer(sdk, io, o.counts) },
        includePartialMessages: true,
        ...(o.resume ? { resume: o.resume } : {}),
        ...(o.chosen ? { model: o.chosen } : {}),
        ...(o.effort ? { effort: o.effort as "low" | "medium" | "high" | "xhigh" | "max" } : {}),
        env: harnessEnv(io.agent.id),
      },
    });
    for await (const m of q) {
      io.alive?.();
      if (m.type === "system" && m.subtype === "init") {
        sessionId = m.session_id;
        reportModel(m.model);
      } else if (m.type === "stream_event") {
        const ev = m.event;
        const main = !m.parent_tool_use_id;
        if (ev.type === "message_start") {
          current.set(m.parent_tool_use_id ?? "", ev.message.id);
          o.tally.call(ev.message.id, ev.message.usage, main);
        } else if (ev.type === "message_delta") o.tally.call(current.get(m.parent_tool_use_id ?? ""), ev.usage, main);
        if (!main) continue;
        if (ev.type === "message_start") {
          text = "";
          streaming = true;
          reportModel(ev.message.model);
        } else if (ev.type === "message_stop") streaming = false;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
          io.onText(prefix + text);
        }
      } else if (m.type === "assistant") {
        o.tally.call(m.message.id, m.message.usage, !m.parent_tool_use_id);
        if (m.parent_tool_use_id) continue;
        reportModel(m.message.model);
        sessionId = m.session_id;
        // Its own tools are shown as cards and recorded as steps; web tools also tell the policy that outside text
        // is now in the turn.
        for (const b of m.message.content)
          if (b.type === "tool_use" && !b.name.startsWith("mcp__apx__")) {
            o.counts.builtins++;
            io.observe({
              callId: b.id,
              title: `${b.name}: ${subjectOf(b.input as Record<string, unknown>).slice(0, 160)}`,
              kind: KIND[b.name] ?? "other",
              status: "ok",
            });
          }
        // Its tools run now: words that arrived go in, and the SDK folds them in after this round.
        if (m.message.content.some((b) => b.type === "tool_use")) words.take("next");
      } else if (m.type === "user") {
        if (!m.parent_tool_use_id) words.take("next");
      } else if (m.type === "result") {
        sessionId = m.session_id;
        o.tally.window(m.modelUsage[model]?.contextWindow);
        // Words that came after its last tool round, or a "send now" that stopped it: the SDK runs them next.
        if (words.waiting(m.user_message_uuids)) {
          if (m.subtype === "success" && m.result) prefix = `${prefix}${m.result}\n\n`;
          text = "";
          continue;
        }
        if (m.subtype !== "success") throw new Error(`claude: ${m.subtype}`);
        const usage = o.tally.total() ?? {
          input:
            (m.usage.input_tokens ?? 0) +
            (m.usage.cache_read_input_tokens ?? 0) +
            (m.usage.cache_creation_input_tokens ?? 0),
          output: m.usage.output_tokens ?? 0,
        };
        return { text: prefix + (m.result || text), model: `claude/${model}`, modelConfirmed, sessionId, usage };
      }
    }
    return { text: prefix + text, model: `claude/${model}`, modelConfirmed, sessionId, usage: o.tally.total() };
  } finally {
    io.signal.removeEventListener("abort", onAbort);
    words.stop();
    input.close();
  }
}

export function claudeHarness(opts: {
  claudePath: () => Promise<string>;
  cwd: (io: TurnIO) => string;
  readImage: ImageReader;
}): Harness {
  return {
    id: "claude",
    async run(io: TurnIO): Promise<TurnOutcome> {
      const base = {
        claudePath: await opts.claudePath(),
        cwd: opts.cwd,
        readImage: opts.readImage,
        chosen: modelPart(io.models[0]),
        effort: effortPart(io.models[0]),
      };
      const counts: Counts = { apx: 0, builtins: 0, permissions: 0 };
      // Across a retry too: the first attempt's calls were spent all the same.
      const tally = claudeUsage((u) => io.onUsage?.(u));
      try {
        return await attempt(io, { ...base, counts, tally, resume: io.sessionId });
      } catch (err) {
        // A stored session can disappear (cleared by the owner): start a fresh one instead of failing the turn,
        // but only for that, and never after any tool ran (ours or Claude's), since a rerun would repeat its effect.
        // See DECISIONS.md#d-007
        const gone = /session|conversation/i.test(errorMessage(err));
        if (io.sessionId && gone && !io.signal.aborted && counts.apx === 0 && counts.builtins === 0) {
          io.onModel?.(undefined);
          return attempt(io, { ...base, counts, tally, resume: undefined });
        }
        throw err;
      }
    },
  };
}
