// One run, start to end: context in, harness loop, every tool call through one executor, an honest end state.
import path from "node:path";
import {
  type Autonomy,
  COMPUTER_CAP,
  type HarnessId,
  type MethodName,
  type Params,
  type Result,
  type Routine,
  type Thread,
} from "@apx/protocol";
import { readOrganization } from "../apc/org.ts";
import type { AgentRecord } from "../domain/agents.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import { ownerIdentity, ownerTimeZone } from "../domain/owner.ts";
import { engineOf, harnessOf, isCliRef } from "../domain/refs.ts";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf, type Worker, worksInFolder } from "../domain/threads.ts";
import { Canceled, DeadlineExceeded, errorMessage, Shutdown, Superseded } from "../errors.ts";
import type { Harnesses, TurnIO, TurnOutcome } from "../harness/index.ts";
import { systemNote } from "../harness/native.ts";
import type { Log } from "../log.ts";
import { candidates, modelSettings } from "../models/choice.ts";
import type { ChatItem, Usage } from "../providers/types.ts";
import { ProviderError } from "../providers/types.ts";
import { contextWindow } from "../providers/windows.ts";
import { saveLocalAttachment } from "../services/attachment-files.ts";
import { askedSkill } from "../skills/picker.ts";
import type { RuntimeHomes } from "../skills/runtimes.ts";
import { agentSkills, skillCatalog, skillsFor } from "../skills/skills.ts";
import { CONTACT_TOOLS, contactToolNames } from "../tools/contact.ts";
import { harnessDir, readOnlyFolders, scratchDir, workDir } from "../tools/folders.ts";
import { IMESSAGE_TOOLS } from "../tools/imessage.ts";
import { MCP_CALL, MCP_SEARCH, mcpBridge } from "../tools/mcp-bridge.ts";
import { inherit, modeOf } from "../tools/policy.ts";
import { waitingBlock } from "../tools/requests.ts";
import { UNTRUSTED_MARK, untrusted } from "../tools/result.ts";
import { type Tool, toSpec } from "../tools/types.ts";
import { WEB_TOOLS } from "../tools/web.ts";
import { callersOf } from "./ancestry.ts";
import { attachmentsBlock } from "./attachments.ts";
import {
  type Audience,
  audienceOf,
  contactPrompt,
  ownerInstruction,
  roomInput,
  roomPrompt,
  sealedWeb,
} from "./audience.ts";
import { gitChanges } from "./changes.ts";
import { memoryQuery, recallChats } from "./chat-recall.ts";
import {
  frameInput,
  HISTORY_BUDGET_CHARS,
  modeBlock,
  type ProjectBrief,
  project,
  releaseBlock,
  rosterBlock,
  systemPrompt,
  turnInput,
  workerPrompt,
  workspaceBlock,
} from "./context.ts";
import { type Caller, type DelegateTo, resultCard } from "./delegation.ts";
import { type Display, openDisplay } from "./display.ts";
import { createExecutor, type Executor } from "./executor.ts";
import type { Hooks } from "./hooks.ts";
import type { Inputs } from "./inputs.ts";
import type { Jobs } from "./jobs.ts";
import { MAX_DEPTH } from "./limits.ts";
import type { MemoryIndex } from "./memory-index.ts";
import { memoryHistory, snapshotOf, visibleMemoryRuns, windowRuns } from "./memory-projection.ts";
import { ratingNote, sentMeanwhile } from "./nudges.ts";
import { taskBlock } from "./office.ts";
import type { Permissions } from "./permissions.ts";
import { type MailSource, POST_AFTER_DEADLINE_MS, routinePipeline, routineWithCommands, stepsFor } from "./pipeline.ts";
import { type ProfileRoot, profileBlock } from "./profiles.ts";
import { resetLabel } from "./provider-limit.ts";
import { recallFor } from "./recall.ts";
import { closeTurnLog, RESUME_NOTE } from "./recovery.ts";
import { askedPick, type SkillPicker } from "./skill-pick.ts";

export type TurnDeps = {
  store: Store;
  harnesses: Harnesses;
  tools: Tool[];
  log: Log;
  inputs: Inputs;
  jobs: Jobs;
  /** APX's home: the owner's skills live under it. */
  home: string;
  /** The other agent apps whose skills agents may load too. */
  skillApps?: RuntimeHomes | undefined;
  apxPort: () => number;
  /** Notes by words and by meaning. */
  memory: MemoryIndex;
  /** Skills picked by meaning for this message. */
  skills?: SkillPicker | undefined;
  /** Where profiles are found: the running one adds its block to the super-agent's system prompt. */
  profileRoots?: readonly ProfileRoot[] | undefined;
  /** This core's version and commit: agents can tell the owner which APX they run on. */
  build?: { version: string; code_sha: string } | undefined;
  hooks?: Hooks | undefined;
  mcpTools?: ((thread: Thread) => Promise<Tool[]>) | undefined;
  /** The MCP servers a thread may reach, by name, without starting them. */
  mcpServers?: ((thread: Thread) => string[]) | undefined;
  /** Whether a connected node lends a capability: tools that need one are offered only then. */
  hasCap?: ((cap: string) => boolean) | undefined;
  /** The owner's Gmail, for mail routines. */
  mail?: MailSource | undefined;
  /** Whether a desktop app is linked as a node (lending its browser), whatever else it lends. */
  desktopLinked?: (() => boolean) | undefined;
  /** Owner text steered into this turn since the last call. */
  takeSteered(): string[];
  /** The engine showed a sign of life: an outside engine's idle deadline starts over. */
  alive?: (() => void) | undefined;
  /** The turn waits on work in progress (a command running): its idle deadline holds until the returned call. */
  busy?: (() => () => void) | undefined;
  /** A protocol method through the router, as the agent of `as.run`. */
  call: ToolCall;
  /** How the agent acts and how far its files reach: every permission question goes here. */
  permissions: Permissions;
  delegate(caller: Caller, to: DelegateTo, task: string, waitMs: number): Promise<string>;
};

export type ToolCall = <M extends MethodName>(
  method: M,
  params: Params<M>,
  /** `owner`: the call acts for the owner, who just approved this very tool call (see ToolContext.callAsOwner). */
  as: { run: RunRecord; callId: string; owner?: boolean },
) => Promise<Result<M>>;

/** What only a caller may use: a delegate asks no one (DECISIONS.md#d-074). */
const SESSION_TOOLS = new Set(["delegate", "list_sessions", "stop_session"]);
const MEMORY_TOOLS = new Set(["remember", "recall", "forget", "search_owner_notes"]);
/**
 * The owner's turns on WhatsApp keep notes, write to people and rooms, and hand the rest off: a phone chat is no place
 * for tool cards, so other tool work goes to an agent of its own (delegate). A send stays here, since what the owner
 * asked to send cannot be relayed to another agent; its confirmation comes as numbered options.
 */
const HANDOFF_ONLY = new Set(["whatsapp"]);
const HANDOFF_TOOLS = new Set([
  ...MEMORY_TOOLS,
  "delegate",
  "list_agents",
  "read_output",
  "load_skill",
  "message_contact",
  "channel_post",
  "channel_list",
  "contact_list",
  "read_chat",
]);

type Turn = {
  agent: AgentRecord;
  thread: Thread;
  input: NonNullable<RunRecord["input"]>;
  audience: Audience;
  /** A sealed turn (a room, a contact's chat) its channel lets search the web and read public pages. */
  web: boolean;
  /** In a worker's session: the instructions its caller wrote (the agent is the caller itself). */
  worker?: Worker | undefined;
};
/** What runs a turn: our loop with its chain of model APIs, or a CLI in its own session with one model. */
type Engine = { harness: HarnessId; refs: string[] };

export async function runTurn(deps: TurnDeps, start: RunRecord, signal: AbortSignal): Promise<RunRecord> {
  const { store } = deps;
  const thread = store.threads.get(start.thread_id);
  const agent = store.agents.get(start.agent_id);
  if (!thread || !agent || !start.input)
    return store.runs.setState(start, "failed", !start.input ? "run has no input" : "thread or agent is gone");
  const audience = audienceOf(store, thread);
  const turn: Turn = {
    agent,
    thread,
    input: start.input,
    audience,
    web: sealedWeb(store, audience, start.input.origin),
    worker: store.threads.context(thread.id).worker,
  };

  let run = store.runs.setState(start, "working");
  store.threads.patch(thread.id, { state: "working" });
  const display = openDisplay(
    store,
    store.messages.add({ thread_id: thread.id, author: { kind: "agent", id: agent.id }, parts: [], run_id: run.id }),
  );
  run = store.runs.patch(run, { message_id: display.message.id });
  // A delegated result arriving later: its report shows above what the caller makes of it.
  const report =
    start.input.origin.kind === "delegation_result" ? resultCard(store, start.input.origin.run_id) : undefined;
  if (report) display.upsert((p) => p.type === "subthread" && p.thread_id === report.thread_id, report);
  // A routine with commands of its own: the pre-command first; its result may say the model is not needed.
  const routine = routineWithCommands(store, run);
  const pipe = routine && routinePipeline({ store, home: deps.home, routine, run, display, mail: deps.mail });
  // The post-command runs whatever the outcome, except when the owner canceled or the core is stopping; after a
  // missed deadline it gets a short limit. It never changes the run's state.
  const end = async (done: RunRecord, skipped = false) => {
    const why = signal.reason;
    if (!pipe || why instanceof Canceled || why instanceof Shutdown) return done;
    try {
      await pipe.after(done, skipped, why instanceof DeadlineExceeded ? POST_AFTER_DEADLINE_MS : undefined);
    } catch (err) {
      deps.log.warn({ run: done.id, err: errorMessage(err, 200) }, "post-command failed");
    }
    return done;
  };

  // Anything failing while the turn is prepared (a plugin, an MCP server) still ends the run with a state.
  let prepared: Awaited<ReturnType<typeof buildContext>> & Awaited<ReturnType<typeof turnTools>>;
  try {
    if (pipe) {
      const pre = await pipe.before(signal);
      signal.throwIfAborted();
      if (!pre.call)
        return end(
          pre.message !== undefined
            ? sendAsIs(store, { run, thread, display, text: pre.message })
            : skipModel(store, { run, thread, display, action: routine?.action }),
          true,
        );
      turn.input = { ...turn.input, text: pre.prompt(turn.input.text) };
    }
    const tooling = await turnTools(deps, turn);
    prepared = { ...(await buildContext(deps, turn, run, modeOf(tooling.policy.agent))), ...tooling };
  } catch (err) {
    return end(failRun(deps, { run, turn, display, signal, err }));
  }
  const { history, input, skills, picked, inView, policy, tools, mcpLate } = prepared;
  if (picked) display.upsert((p) => p.type === "skills", picked.part);
  let harness: HarnessId = "native";
  const startedUntrusted = [...history, input].some((m) => String(m.content ?? "").includes(UNTRUSTED_MARK));
  const exec = createExecutor({
    store,
    inputs: deps.inputs,
    tools,
    late: mcpLate,
    agent: policy.agent,
    thread,
    run: () => run,
    display,
    signal,
    untrusted: startedUntrusted,
    inView,
    external: () => harness !== "native",
    call: deps.call,
    jobs: deps.jobs,
    busy: deps.busy,
    apxPort: deps.apxPort,
    workDir: harnessDir(store, deps.home, thread),
    permissions: deps.permissions,
    // Harnesses and delegations see the agent as it acts here (its project's and callers' mode), never its bare record.
    delegate: (to, task, waitMs) => deps.delegate({ run, agent: policy.agent, display }, to, task, waitMs),
  });
  const io = (): TurnIO => ({
    agent: policy.agent,
    thread,
    run,
    system: thread.engine
      ? DIRECT_NOTE
      : systemFor(
          store,
          turn,
          skills,
          deps.profileRoots ?? [],
          deps.build,
          scratchDir(store, deps.home, thread),
          Boolean(deps.desktopLinked?.()) && !deps.hasCap?.(COMPUTER_CAP),
        ),
    history,
    input,
    tools: tools.map(toSpec),
    steps: stepsFor(store, run),
    models: [],
    signal,
    sessionId: undefined,
    outside: () => exec.untrusted,
    onText: display.text,
    // Kept as it grows: a turn that fails or is canceled still shows what it spent.
    onUsage: (u) => {
      run = store.runs.patch(run, { usage: u });
    },
    execute: exec.execute,
    approve: exec.approve,
    observe: exec.observe,
    showImage: (file) => showImage(deps, { thread, run, display, owner: audience.kind === "owner" }, file),
    takeSteered: deps.takeSteered,
    alive: deps.alive ?? (() => {}),
    log: (items) => store.modelLog.append(thread.id, run.id, items),
  });

  try {
    const engine = enginePick(deps, turn, start, history);
    const outcome = await runEngine(deps, engine, {
      io,
      input,
      signal,
      thread,
      run: () => run,
      onHarness: (h) => {
        harness = h;
        run = store.runs.patch(run, { harness: h });
      },
    });
    // An engine keeps its own session: what it read from outside stays in its context for the next turns too.
    if (thread.engine && exec.untrusted && !startedUntrusted)
      store.modelLog.append(thread.id, run.id, [{ role: "user", content: OUTSIDE_IN_SESSION }]);
    run = await finishRun(store, { run, thread, display, exec, outcome, log: deps.log });
  } catch (err) {
    run = failRun(deps, { run, turn, display, signal, err });
  }
  return end(run);
}

/** A picture the engine made on its own, kept as the chat's media; local files reach only the owner's chats. */
function showImage(
  deps: TurnDeps,
  t: { thread: Thread; run: RunRecord; display: Display; owner: boolean },
  file: string,
): void {
  if (!t.owner) return;
  try {
    const m = saveLocalAttachment(deps.home, deps.store, path.dirname(file), t.thread.id, path.basename(file));
    if (m.kind !== "image") return;
    t.display.upsert((p) => p.type === "image" && p.media_id === m.id, {
      type: "image",
      media_id: m.id,
      mime: m.mime,
      alt: "Generated image",
    });
  } catch (err) {
    deps.log.warn({ run: t.run.id, err: errorMessage(err, 200) }, "could not show a generated image");
  }
}

/** Kept in an engine thread's log once its session has read outside content, so later turns start untrusted. */
const OUTSIDE_IN_SESSION = untrusted(
  "session_note",
  {},
  "This engine session read content from outside APX in an earlier turn; it is still in its context.",
);

/** A message routine's text, as the run's answer: delivered to the owner like any routine's, with no model call. */
function sendAsIs(store: Store, t: { run: RunRecord; thread: Thread; display: Display; text: string }): RunRecord {
  t.display.finalText(t.text);
  const run = store.runs.setState(t.run, "completed", undefined, { reason: "normal" });
  store.threads.patch(t.thread.id, { state: "idle", preview: previewOf(t.text) });
  return run;
}

/** A routine's run whose pre-command said the model is not needed (or a shell routine): done, without a model call. */
function skipModel(
  store: Store,
  t: { run: RunRecord; thread: Thread; display: Display; action?: Routine["action"] | undefined },
): RunRecord {
  if (t.action === "shell") t.display.notice("info", "routine.shell", "Ran the command.");
  else if (t.action === "watch")
    t.display.notice("info", "routine.watch.quiet", "Nothing new to watch: the model was not called.");
  else if (t.action === "relay")
    t.display.notice("info", "routine.relay.quiet", "No team news to tell: the model was not called.");
  else
    t.display.notice(
      "info",
      "routine.skipped",
      "The model was not called; the pre-command's result did not ask for it.",
    );
  const run = store.runs.setState(t.run, "completed", undefined, { reason: "normal" });
  store.threads.patch(t.thread.id, { state: "idle", preview: previewOf("Ran without calling the model.") });
  return run;
}

/** The model's view of the thread and this turn's framed input (with notes and the roster when they apply). */
async function buildContext(deps: TurnDeps, turn: Turn, run: RunRecord, mode: Autonomy) {
  const { store } = deps;
  const { agent, thread } = turn;
  // A contact's turn knows nothing of the owner's: no notes, no roster, no skills. An engine session is the engine
  // itself: none of an agent's notes, roster, skills or framing either.
  const direct = Boolean(thread.engine);
  const sealed = turn.audience.kind === "contact" || direct;
  const remembers = !sealed && memorySettings(store).mode !== "off";
  const ctxState = store.threads.context(thread.id);
  // A public room's turn reads the room's latest messages instead of a history of its own.
  const room = turn.audience.kind === "contact" ? turn.audience.room : undefined;
  const entries = memoryHistory(store, store.modelLog.list(thread.id), agent.id, thread.project_id);
  const projected = room
    ? { items: [] as ChatItem[], from: 0 }
    : project(entries, HISTORY_BUDGET_CHARS, ctxState.compaction);
  const { from } = projected;
  const roster = rosterBlock(agent, store.agents.list(), thread);
  // A worker delegates to no one: it needs no roster.
  const rosterChanged =
    !sealed && !turn.worker && (ctxState.roster_hash !== roster.hash || ctxState.roster_agent !== agent.id);
  const available = sealed
    ? []
    : agentSkills(agent, skillsFor(store, { home: deps.home, apps: deps.skillApps }, thread.project_id));
  // A skill named with "/name" goes in as asked; otherwise skills are weighed while notes are recalled (both wait on
  // the embedding engine).
  const asked = askedSkill(turn.input.text, available);
  const picking = asked ? Promise.resolve(askedPick(asked)) : deps.skills?.pick(turn.input.text, available);
  const recalled = remembers
    ? await recallFor(
        store,
        deps.memory.search,
        agent.id,
        thread,
        memoryQuery(store, thread.id, turn.input.text),
        ctxState,
        from,
        turn.input.origin.kind === "agent",
      )
    : {};
  const chats = remembers
    ? await recallChats(store, deps.memory, agent.id, thread, turn.input.text, {
        excludeRuns: visibleMemoryRuns(store, entries, from, run.id),
      })
    : undefined;
  const picked = await picking;
  // A plugin's context is for the owner's own turns only (not other agents', apps' or contacts'), as outside data.
  const o = turn.input.origin;
  const ownerTurn =
    o.kind === "user" ||
    o.kind === "input_answer" ||
    o.kind === "routine" ||
    (o.kind === "channel" && o.role === "owner");
  const extra =
    !sealed && ownerTurn && deps.hooks
      ? await deps.hooks.context({
          thread: { id: thread.id, kind: thread.kind, title: thread.title, project_id: thread.project_id },
          agent: { id: agent.id, name: agent.name },
          text: turn.input.text.slice(0, 4000),
        })
      : undefined;
  // In a contact's chat the owner's own words (typed in the app) say what to answer that contact (a room's: roomInput).
  const said =
    turn.audience.kind === "contact" && !turn.audience.room && o.kind === "user"
      ? ownerInstruction(turn.audience.name, turn.input.text)
      : turn.input.text;
  const files = attachmentsBlock(
    store,
    turn.input.attachments ?? [],
    turn.audience.kind === "contact" ? undefined : { home: deps.home, thread },
  );
  const liveThread = store.threads.get(thread.id);
  if (!liveThread || liveThread.project_id !== thread.project_id || !liveThread.agent_ids.includes(agent.id))
    throw new Error("chat access changed while preparing its context");
  const memoryBlock =
    memorySettings(store).mode !== "off" ? [recalled.text, chats?.render()].filter(Boolean).join("\n") : "";
  const images = (turn.input.attachments ?? []).filter((a) => a.kind === "image");
  // A resumed turn already has its message in the history: it only learns why it stopped.
  const input: ChatItem & { role: "user" } = turn.input.resume_of
    ? (systemNote(RESUME_NOTE) as ChatItem & { role: "user" })
    : {
        role: "user",
        ...(images.length ? { images: images.map((a) => ({ media_id: a.media_id, mime: a.mime })) } : {}),
        content: room
          ? roomInput(store, {
              threadId: thread.id,
              runId: run.id,
              agentName: agent.name,
              from: o.kind === "channel" ? o.name : "your owner",
              owner: o.kind !== "channel" || o.role === "owner",
              text: said,
              app: o.kind === "user",
            })
          : direct
            ? // An engine session gets no header, but a result or outside text still says what it is and what to do.
              o.kind === "go_on"
              ? said
              : frameInput(o, files ? `${said}\n\n${files}` : said)
            : turnInput({
                origin: turn.input.origin,
                text: files ? `${said}\n\n${files}` : said,
                now: new Date(),
                roster: rosterChanged ? roster.text : undefined,
                memory: memoryBlock,
                skills: picked?.block || undefined,
                task: taskBlock(store, thread),
                extension: extra ? untrusted("extension_context", { from: extra.from }, extra.text) : undefined,
                waiting: !sealed && ownerTurn && o.kind !== "routine" ? waitingBlock(store, agent.id) : undefined,
                timeZone: ownerTimeZone(store),
                channel: channelKindOf(store, o, turn.input.reply_to === null ? null : turn.input.reply_to?.channel),
                voice: o.kind === "channel" && Boolean(store.threads.context(thread.id).voice_replies),
                mode: modeBlock(mode),
                workspace: workspaceBlock(thread, readOnlyFolders(store, thread), workDir(store, deps.home, thread)),
                release: ownerTurn ? releaseBlock(store.threads.context(thread.id).release) : undefined,
                feedback: o.kind === "routine" ? ratingNote(store, `routine:${o.name}`) || undefined : undefined,
                // The owner's channel lands in Home: what went out on it meanwhile is what they may be answering.
                meanwhile:
                  thread.kind === "home" && (o.kind === "user" || (o.kind === "channel" && o.role === "owner"))
                    ? sentMeanwhile(store, thread.id, run.id)
                    : undefined,
              }),
      };
  const history = room
    ? []
    : project(
        memoryHistory(store, store.modelLog.list(thread.id), agent.id, thread.project_id),
        HISTORY_BUDGET_CHARS,
        store.threads.context(thread.id).compaction,
      ).items;
  const at = store.modelLog.append(
    thread.id,
    run.id,
    [input],
    snapshotOf(store, input.content, memoryBlock, agent.id, thread.project_id),
  );
  if (rosterChanged || recalled.shown)
    store.threads.mergeContext(thread.id, {
      ...(rosterChanged ? { roster_hash: roster.hash, roster_agent: agent.id } : {}),
      ...(recalled.shown ? recalled.shown(at) : {}),
    });
  const skills = sealed ? "" : skillCatalog(available);
  // A room's turn has no history of its own: only its run is in view.
  const inView = room ? new Set([run.id]) : windowRuns(entries, from, run.id);
  return { history, input, skills, picked, inView };
}

/** The kind of channel a message came on ("telegram"), for how the answer should look; none for the app. */
function channelKindOf(store: Store, o: Origin, replyChannel?: string | null) {
  const channel = replyChannel === null ? undefined : (replyChannel ?? (o.kind === "channel" ? o.channel : undefined));
  if (!channel) return undefined;
  return store.settings.read("channels").find((c) => c.id === channel)?.type ?? channel;
}

/** The tools this turn may use: the agent's, narrowed by whoever asked for it up the chain; a contact's, by their flags. */
async function turnTools(deps: TurnDeps, turn: Turn) {
  const sealed = turn.audience.kind === "contact";
  const callers = callersOf(deps.store, turn.thread.id);
  // MCP tools are reached through mcp_search and mcp_call; their servers start only when one is first used.
  const servers = !sealed && deps.mcpTools ? (deps.mcpServers?.(turn.thread) ?? []) : [];
  let loading: Promise<Tool[]> | undefined;
  const mcpLate = () => {
    loading ??= (deps.mcpTools?.(turn.thread) ?? Promise.resolve([]))
      .catch(() => [])
      .then((all) => all.filter((t) => policy.allows(t.name) && (!only || only.has(t.name) || only.has(MCP_CALL))));
    return loading;
  };
  const bridge = servers.length ? mcpBridge(servers, mcpLate) : [];
  // With memory off, the tools that read or write it are not offered; iMessage's only once the owner turned it on; a
  // tool with `when` (an account's) only where it says.
  const memoryOn = memorySettings(deps.store).mode !== "off";
  const imessageOn = deps.store.settings.read("imessage").on;
  const offered = deps.tools.filter(
    (t) =>
      (memoryOn || !MEMORY_TOOLS.has(t.name)) &&
      (imessageOn || !IMESSAGE_TOOLS.has(t.name)) &&
      (!t.needsCap || Boolean(deps.hasCap?.(t.needsCap))) &&
      (!t.when || t.when(turn.thread)),
  );
  // A contact's turn gets only what the owner allowed for that person (nothing by default); the owner's turns never
  // see the contact-only tools.
  const forContact =
    turn.audience.kind === "contact"
      ? new Set([...contactToolNames(turn.audience.person?.perms), ...(turn.web ? WEB_TOOLS : [])])
      : new Set<string>();
  const narrowed = inherit(
    turn.agent,
    callers,
    sealed
      ? offered.filter((t) => forContact.has(t.name))
      : [...offered.filter((t) => !CONTACT_TOOLS.has(t.name)), ...bridge],
  );
  // The mode it acts in comes from the one place every permission question asks; its callers narrow its tools.
  const policy = { ...narrowed, agent: deps.permissions.agentIn(turn.agent, turn.thread.id) };
  // A worker asks no one, and keeps to the tools its caller named for it (when it named any).
  const named = turn.worker?.tools?.length ? new Set(turn.worker.tools) : undefined;
  const o = turn.input.origin;
  const handoff = o.kind === "channel" && o.role === "owner" && HANDOFF_ONLY.has(channelKindOf(deps.store, o) ?? "");
  const only = handoff ? new Set([...HANDOFF_TOOLS].filter((n) => !named || named.has(n))) : named;
  const tools = policy.tools.filter(
    (t) =>
      ((callers.length < MAX_DEPTH && !turn.worker) || !SESSION_TOOLS.has(t.name)) &&
      (!only || only.has(t.name) || (t.name === MCP_SEARCH && only.has(MCP_CALL))),
  );
  return { policy, tools, mcpLate };
}

/** "2.1.1 (commit 75d71df)"; a checkout's placeholder version reads as a development build. */
export function apxBuild(b: { version: string; code_sha: string }): string {
  const sha = b.code_sha && b.code_sha !== "unknown" ? `commit ${b.code_sha.slice(0, 7)}` : "";
  if (b.version === "0.0.0") return `a development build${sha ? ` (${sha})` : ""}`;
  return `${b.version}${sha ? ` (${sha})` : ""}`;
}

/** All an engine session adds to the engine's own prompt (Claude Code appends it; the others take nothing). */
const DIRECT_NOTE =
  "You are running inside APX, the owner's local assistant app; they talk to you directly in this chat. APX's own tools (mcp__apx__*) are there if useful.";

function systemFor(
  store: Store,
  turn: Turn,
  skills: string,
  roots: readonly ProfileRoot[],
  build?: { version: string; code_sha: string },
  scratch = "",
  computerOff = false,
): string {
  const lang = store.settings.get("owner_language") || "es";
  if (turn.audience.kind === "contact")
    return turn.audience.room
      ? roomPrompt(turn.agent, turn.audience.room, lang, turn.web)
      : contactPrompt(turn.agent, turn.audience, lang, turn.web);
  // The thread's project when it has one (a global agent working there needs its AGENTS.md too).
  const projectId = turn.thread.project_id ?? turn.agent.project_id;
  if (turn.worker)
    return workerPrompt(
      turn.worker,
      turn.agent,
      lang,
      projectId ? store.projects.get(projectId) : undefined,
      skills,
      scratch,
    );
  const role = turn.agent.kind === "secretary" ? profileBlock(store, roots) : "";
  return systemPrompt(
    turn.agent,
    turn.thread,
    lang,
    projectBrief(store, projectId),
    skills,
    role,
    ownerIdentity(store),
    build ? apxBuild(build) : "",
    scratch,
    computerOff,
  );
}

/**
 * An engine session runs its CLI with the model the chat picked (one of that CLI's), else the CLI's default. Any other
 * chat runs our loop over the chosen model and the router's chain; a CLI ref saved before D-043 is skipped.
 */
function enginePick(deps: TurnDeps, turn: Turn, start: RunRecord, history: ChatItem[]): Engine {
  // The chat's own model (picked in its composer) first, then the agent's, then the install default.
  const chosen = deps.store.threads.context(turn.thread.id).model_choice ?? turn.agent.model_choice;
  const own = turn.thread.engine;
  if (own) {
    const ref = chosen?.model && engineOf(chosen.model) === own ? chosen.model : own;
    return { harness: harnessOf(ref), refs: [ref] };
  }
  const settings = modelSettings(deps.store);
  const refs = candidates(chosen ?? settings.defaultChoice(), settings.router(), {
    text: turn.input.text,
    context_chars: history.reduce((n, m) => n + String(m.content ?? "").length, 0),
    // An image earlier in the chat still travels with each call: the model must be able to see it.
    has_image:
      Boolean(turn.input.attachments?.some((a) => a.kind === "image")) ||
      history.some((m) => m.role === "user" && Boolean(m.images?.length)),
    channel: turn.thread.channel?.id ?? "app",
    trigger: start.trigger,
    agent_kind: turn.agent.kind,
  }).filter((r) => !isCliRef(r));
  if (!refs.length)
    throw new Error(
      "no model chosen for this agent and the router has none; connect a model API in Settings → Engines and models",
    );
  return { harness: "native", refs };
}

/** Runs the turn on its engine. A CLI resumes its own session and keeps its id; our log keeps its answer too. */
async function runEngine(
  deps: TurnDeps,
  engine: Engine,
  t: {
    io: () => TurnIO;
    input: ChatItem & { role: "user" };
    signal: AbortSignal;
    thread: Thread;
    run: () => RunRecord;
    onHarness(h: HarnessId): void;
  },
): Promise<TurnOutcome> {
  const { store } = deps;
  t.onHarness(engine.harness);
  const session = t.thread.engine;
  const resumed = session ? store.harnessSessions.get(t.thread.id, session) : undefined;
  const outcome = await deps.harnesses.get(engine.harness).run({
    ...t.io(),
    models: engine.refs,
    sessionId: resumed,
    input: t.input,
  });
  if (outcome.sessionUsage) {
    const before =
      session && outcome.sessionId ? store.harnessSessions.total(t.thread.id, session, outcome.sessionId) : undefined;
    const share = turnShare(outcome.sessionUsage, before, Boolean(resumed) && resumed === outcome.sessionId);
    if (share) outcome.usage = share;
    else deps.log.warn({ run: t.run().id }, "no earlier total for this engine session: the turn's tokens are unknown");
  }
  if (session) {
    if (outcome.sessionId) store.harnessSessions.set(t.thread.id, session, outcome.sessionId, outcome.sessionUsage);
    store.modelLog.append(t.thread.id, t.run().id, [{ role: "assistant", content: outcome.text || null }]);
  }
  t.signal.throwIfAborted();
  return outcome;
}

/**
 * This turn's share of an outside session's running total. A session APX goes on with but holds no total for (one
 * brought in from outside) has spent an unknown part of it before: no figure rather than a wrong one.
 */
export function turnShare(total: Usage, before: Usage | undefined, resumed: boolean): Usage | undefined {
  if (!before) return resumed ? undefined : total;
  const input = Math.max(0, total.input - before.input);
  const cached = Math.min(input, Math.max(0, (total.cached ?? 0) - (before.cached ?? 0)));
  return { input, output: Math.max(0, total.output - before.output), ...(cached ? { cached } : {}) };
}

/** The answer is in: final text (or an honest notice), the code changes card, usage, and the thread back to idle. */
async function finishRun(
  store: Store,
  t: { run: RunRecord; thread: Thread; display: Display; exec: Executor; outcome: TurnOutcome; log: Log },
): Promise<RunRecord> {
  const { display, thread, outcome } = t;
  display.close();
  // The message names the effort too (a model ref); the run keeps the bare model for usage and context windows.
  display.setModel(outcome.effort ? `${outcome.model}#${outcome.effort}` : outcome.model);
  // The chosen model failed and another answered: the owner sees which and why, the log keeps it too.
  const first = outcome.failed?.[0];
  if (first) {
    t.log.warn(
      { run: t.run.id, failed: outcome.failed, answered: outcome.model },
      "model failed, the next one answered",
    );
    display.notice(
      "warn",
      "engine.fallback",
      `${first.model} did not answer (${first.why}); went on with ${outcome.model}.`,
      {
        vars: { model: first.model, why: first.why, to: outcome.model },
        ...(outcome.failed && outcome.failed.length > 1
          ? { detail: outcome.failed.map((f) => `${f.model}: ${f.why}`).join("\n") }
          : {}),
      },
    );
  }
  if (worksInFolder(thread) && thread.cwd) {
    const changes = await gitChanges(thread.cwd);
    if (changes && !display.message.parts.some((p) => p.type === "changes" && p.edits && !p.scratch))
      display.upsert((p) => p.type === "changes" && !p.scratch, changes);
  }
  const text = outcome.text.trim();
  const empty = t.exec.toolsRan ? "Finished without a message." : "The model gave no answer.";
  if (text) display.finalText(text);
  else display.notice("info", "run.empty", empty);
  // Out of steps is not finished: the owner and any caller see it, never a plain completion.
  if (outcome.outOfSteps) display.notice("warn", "run.stepLimit", STEP_LIMIT, { vars: {} });
  const window = outcome.usage?.window ?? (outcome.usage?.context ? contextWindow(outcome.model) : undefined);
  const usage = outcome.usage && { ...outcome.usage, ...(window ? { window } : {}) };
  let run = store.runs.patch(t.run, { model: outcome.model, ...(usage ? { usage } : {}) });
  // Only our own loop can tell; an outside engine's completed turn keeps no reason.
  const end = outcome.outOfSteps ? "step_limit" : (run.harness ?? "native") === "native" ? "normal" : undefined;
  run = store.runs.setState(run, "completed", undefined, end && { reason: end });
  store.threads.patch(thread.id, {
    // A question or confirmation the turn stopped waiting for is still the owner's to answer.
    state: store.inputs.pending(thread.id).length ? "input-required" : "idle",
    preview: previewOf(text || (t.exec.toolsRan ? "Finished without a message." : "No answer.")),
    unread: (store.threads.get(thread.id)?.unread ?? 0) + news(t.run),
  });
  return run;
}

const STEP_LIMIT = "Ran out of steps for this turn: this is a report of what is done and left, not a final answer.";

/** A delegated turn's answer is read in its caller's card, not in the delegated chat: it marks nothing unread there. */
const news = (run: RunRecord) => (run.trigger === "a2a" ? 0 : 1);

/**
 * Canceled or failed: a notice saying why, the model log closed honestly, the run and thread marked. Cut off by
 * APX shutting down: left as it is for the next boot (see recovery.ts).
 */
function failRun(
  deps: TurnDeps,
  t: { run: RunRecord; turn: Turn; display: Display; signal: AbortSignal; err: unknown },
): RunRecord {
  const { store } = deps;
  t.display.close();
  // APX is stopping, not the turn failing: it stays open, and the next boot closes its log and picks it back up.
  if (t.signal.reason instanceof Shutdown) return store.runs.get(t.run.id) ?? t.run;
  const canceled = t.signal.reason instanceof Canceled;
  // An engine killed for running out of time reports "aborted": the owner should read why.
  const reason =
    t.signal.reason instanceof DeadlineExceeded
      ? t.signal.reason.message
      : t.err instanceof Error
        ? t.err.message
        : String(t.err);
  const short = reason.split("\n")[0]?.slice(0, 200) ?? reason;
  // The provider's usage limit, not the agent: it says when it lifts, when the provider said so.
  const limit = !canceled && t.err instanceof ProviderError && t.err.limit ? t.err : undefined;
  const until = limit?.resetsAt ? resetLabel(limit.resetsAt, ownerTimeZone(store)) : undefined;
  const message = canceled
    ? "Canceled."
    : limit
      ? `Stopped by the model provider's usage limit${until ? `, which lifts at ${until}` : " (it did not say when it lifts)"}.`
      : `Could not finish: ${short}`;
  if (!canceled) deps.log.warn({ thread: t.turn.thread.id, agent: t.turn.agent.id, err: reason }, "run failed");
  // Every model tried and none answered (out of quota, signed out, down): said as such, the reasons below it.
  const noModel = t.err instanceof ProviderError;
  if (canceled) t.display.notice("info", "run.canceled", message);
  else
    t.display.notice(
      "error",
      noModel ? "run.noModel" : "run.failed",
      limit ? message : noModel ? "No model could answer." : message,
      {
        vars: limit ? (until ? { variant: "limit", until } : { variant: "limitUnknown" }) : {},
        detail: reason.slice(0, 2000),
      },
    );
  // Cut by the owner's next message is not dropped: the model must not read it as "the owner no longer wants this".
  const why =
    t.signal.reason instanceof Superseded
      ? "A new message from the owner cut this turn off before you answered. What was asked here is still unanswered: answer it too in your next reply, unless the new message replaces it."
      : canceled
        ? "The owner canceled this turn."
        : `This turn failed: ${reason}`;
  closeTurnLog(store, t.run, why);
  const deadline = t.signal.reason instanceof DeadlineExceeded;
  const end = canceled ? "canceled" : limit ? "provider_limit" : deadline ? "deadline" : "failed";
  const run = store.runs.setState(t.run, canceled ? "canceled" : "failed", message, {
    reason: end,
    resets_at: limit?.resetsAt,
  });
  // A failure is news the owner has not seen yet; a cancel is their own doing.
  store.threads.patch(t.turn.thread.id, {
    state: canceled ? "canceled" : "failed",
    preview: previewOf(message),
    ...(canceled ? {} : { unread: (store.threads.get(t.turn.thread.id)?.unread ?? 0) + news(t.run) }),
  });
  return run;
}

/**
 * The project a turn works in, for its prompt: a real one with its kind and areas; the base project only once the
 * owner gave it a kind or areas (otherwise there is nothing to say about it).
 */
function projectBrief(store: Store, projectId: string | undefined): ProjectBrief | undefined {
  if (projectId) {
    const p = store.projects.get(projectId);
    if (!p) return undefined;
    const org = p.path && p.present ? readOrganization(p.path) : undefined;
    return { ...p, ...(org && (org.areas.length || org.roles.length) ? { org } : {}) };
  }
  const base = store.settings.read("base_project");
  const org = store.settings.read("base_org");
  const hasOrg = org.areas.length > 0 || org.roles.length > 0;
  if (!base.kind && !hasOrg) return undefined;
  return { name: base.name, ...(base.kind ? { kind: base.kind } : {}), ...(hasOrg ? { org } : {}) };
}
