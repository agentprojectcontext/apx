// Agent-to-agent (A2A) reply: given a sender and a recipient PEER, produce the
// recipient's answer. The recipient is either an AGENTS.md agent (answered by
// its model) or an external coding runtime — opencode, codex, claude-code —
// answered by spawning that CLI and reading its stdout. The same shape comes
// back either way, so the caller logs both kinds of exchange identically.
//
// Pure orchestration over core/agent + core/engines + core/runtimes: no HTTP,
// no message-log writes (the caller decides whether and where to persist).
import { callEngine } from "../../engines/index.js";
import { readAgentMemory } from "../memory.js";
import { resolveAgentModel } from "../agent-model.js";
import { resolveAgentName } from "../../identity/self.js";
import { readProfileState } from "../../profiles/store.js";
import { getRuntime } from "../../runtimes/index.js";
import { runtimeLooksLikeFailure } from "../../runtimes/outcome.js";
import { a2aSessionKey } from "./peers.js";

// The super-agent's own slug — the orchestrator that speaks to the owner.
const ORCHESTRATOR_SLUGS = new Set(["default", "roby", "superagent", "super_agent", "super-agent", "apx"]);

// A shell word only needs quoting when it isn't one. A `:thread` address is
// safe unquoted in every shell we target, but the quotes cost nothing and cover
// whatever an agent slug turns out to allow.
const shellArg = (s) => (/^[A-Za-z0-9_-]+$/.test(String(s)) ? String(s) : `"${s}"`);

/**
 * The return address, written as the exact command that reaches it.
 *
 * This is what makes an a2a message answerable rather than a broadcast: a peer
 * that can open a terminal — every coding CLI, and any agent with run_shell —
 * learns who asked and how to reach them back, without the sender having to
 * explain the addressing scheme in prose every time.
 */
export function a2aReplyCommand({ selfAddress, peerAddress }) {
  return `apx send ${shellArg(selfAddress)} ${shellArg(peerAddress)} "<your message>" --deliver`;
}

/** a2a etiquette every recipient must follow, agent or runtime alike. An a2a
 *  message is another AGENT talking, never the human owner — so a reply must
 *  not "answer the owner", and must not ping the owner directly. What reaches
 *  the owner, and when, is the orchestrator's (Roby's) call, through its own
 *  channel and quiet-hours. */
function a2aEtiquette({ selfAddress, peerAddress, config }) {
  const selfName = String(selfAddress || "").toLowerCase().split("#")[0].split(":")[0];
  const configuredName = (resolveAgentName(config) || "").toLowerCase();
  const isOrchestrator = ORCHESTRATOR_SLUGS.has(selfName) || (configuredName && selfName === configuredName);
  const secretaryActive = readProfileState(config).active === "secretary";
  const superName = resolveAgentName(config) || "the orchestrator";
  const lines = [
    "## This is an agent-to-agent (a2a) message",
    "It comes from another AGENT, not from the human owner. Do NOT notify the owner directly from this turn (no `apx telegram send`, no direct owner ping).",
  ];
  if (isOrchestrator) {
    lines.push(
      "You are the orchestrator: YOU decide whether, how and when the owner hears about this — on your own channel, respecting quiet-hours. Don't relay noise; relay what the owner actually needs.",
    );
  } else {
    lines.push(
      `You are NOT the orchestrator: if this needs the owner's attention or a decision, relay it to ${superName} (\`apx send <you> default "…" --deliver\` or \`apx send <you> ${superName.toLowerCase()} "…" --deliver\`) and let ${superName} decide how and when to tell them. Tag urgency: \`--severity blocker\` for a critical alert (${superName} pings the owner in the act, crossing quiet-hours), \`--severity status\`/\`fyi\` for a normal notice that rides the digest. Otherwise just do your part and reply here.`,
    );
  }
  if (secretaryActive) {
    lines.push(
      "A secretary profile is active: anything promised to, owed to, or that the owner must act on has to be CAPTURED (a commitment via `record_commitment` / `apx commitment`, with a due date) so it resurfaces at the right time — a single a2a message is not a reminder and quiet-hours can swallow it.",
    );
  }
  // The anti-double-post rule. Both kinds of peer answer by PRODUCING their
  // reply — a model returns text, a CLI writes stdout — and APX files that as
  // the reply. A peer that also shells out `apx send` with the same answer
  // files the exchange twice and starts a second, overlapping thread.
  lines.push(
    [
      "## How to answer",
      `Your output IS the reply: APX logs it and hands it straight back to ${peerAddress}. Just answer here.`,
      "Do NOT also run `apx send` to deliver this same answer — that files it twice.",
      "",
      "Use `apx send` only to open a NEW exchange: a later follow-up once this turn is over, or a message to somebody else. This thread's address is:",
      "",
      `    ${a2aReplyCommand({ selfAddress, peerAddress })}`,
    ].join("\n"),
  );
  return lines.join("\n\n");
}

/**
 * Build the recipient AGENT's system prompt for an A2A reply.
 * Includes Description, Role, Language, a persona line naming the sender,
 * the a2a etiquette (routing, return address, secretary capture), and the
 * recipient's memory.
 */
export function buildA2AReplySystem({
  projectPath,
  toAgent,
  fromAgent,
  config,
  selfAddress = null,
  peerAddress = null,
  mode = "chat",
}) {
  const self = selfAddress || toAgent.slug;
  const peer = peerAddress || fromAgent.slug;
  const tf = toAgent?.fields || {};
  const parts = [];
  if (tf.Description) parts.push(tf.Description);
  if (tf.Role) parts.push(`Role: ${tf.Role}`);
  if (tf.Language) parts.push(`Default language: ${tf.Language}`);
  parts.push(`You are ${self}. You just received a message from ${peer}. Reply concisely.`);
  if (mode === "code") {
    // An agent peer has no sandbox to open — it answers through its model, with
    // whatever its own turn allows. `--code` still changes what is being ASKED
    // of it, so the framing has to say so rather than silently reading the same.
    parts.push(
      "This exchange was opened as a CODING session: answer at the level of the code — concrete files, " +
      "concrete changes, concrete commands — not a summary of the area.",
    );
  }
  parts.push(a2aEtiquette({ selfAddress: self, peerAddress: peer, config }));
  if (projectPath && toAgent.slug) {
    // Same file buildAgentSystem injects — an A2A turn must not read a
    // different memory than a normal turn, or the agent contradicts itself
    // depending on who asked.
    const memory = readAgentMemory(projectPath, toAgent.slug);
    if (memory) parts.push("## Memory\n" + memory);
  }
  return parts.join("\n\n");
}

/** What the peer is here to DO. The two halves of the split the `--code` flag
 *  names: an exchange is either people talking about the code, or a working
 *  session on it. The prompt says which, and the adapter backs it with the
 *  runtime's own read-only mode so the sentence is enforced, not just asked. */
function modeBrief(mode) {
  if (mode === "code") {
    return [
      "This is a CODING session. You are expected to do the work, not describe it:",
      "read what you need, make the changes, run what verifies them — then report what you actually",
      "changed, briefly. Your write access is on for this exchange.",
    ].join(" ");
  }
  return [
    "This is a conversation, not a task. Answer directly and concisely.",
    "You are in READ-ONLY mode: you can look at anything, but you cannot change it.",
    "If answering well would mean editing the codebase, say what you would change and why —",
    "the sender can reopen the exchange as a coding session if they want it done.",
  ].join(" ");
}

/** Build the recipient RUNTIME's system prompt. There is no persona to load —
 *  the CLI is itself, with its own project context — so this says only who it
 *  is being addressed as, what kind of exchange this is, and the same etiquette
 *  every peer gets. */
export function buildA2APeerSystem({ projectName, peer, selfAddress, peerAddress, config, mode = "chat" }) {
  return [
    `You are "${selfAddress}" inside APX — the ${peer.runtime} CLI, reached as an agent-to-agent peer.`,
    projectName ? `Project: ${projectName}.` : "",
    `A message from ${peerAddress} follows. ${modeBrief(mode)}`,
    a2aEtiquette({ selfAddress, peerAddress, config }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The thread so far, as text, for a peer that cannot resume its own session. */
function flattenHistory(history) {
  if (!history?.length) return "";
  const lines = history.map((m) =>
    m.role === "assistant" ? `You said:\n${m.content}` : m.content,
  );
  return ["## Earlier in this exchange (oldest first)", ...lines].join("\n\n");
}

/**
 * Run one A2A turn against an AGENT: build system, call engine.
 * Returns { text, usage, model }. Throws on engine failure.
 */
export async function replyAsAgent({
  projectPath,
  toAgent,
  fromAgent,
  body,
  config,
  history = [],
  selfAddress = null,
  peerAddress = null,
  mode = "chat",
}) {
  const modelId = await resolveAgentModel({ agent: toAgent, config });
  if (!modelId) {
    throw new Error(
      `no model for agent ${toAgent?.slug || "?"} (no override, no router default)`
    );
  }
  const peer = peerAddress || fromAgent.slug;
  const system = buildA2AReplySystem({
    projectPath,
    toAgent,
    fromAgent,
    config,
    selfAddress,
    peerAddress: peer,
    mode,
  });
  // Prior turns of THIS pair's a2a thread go in front of the new message, so the
  // reply is a continuation, not a stateless one-shot. Without this the agent has
  // amnesia between a2a turns (it literally sees only the latest message).
  const result = await callEngine({
    modelId,
    system,
    messages: [...history, { role: "user", content: `From ${peer}:\n\n${body}` }],
    config,
  });
  // Return the model too: the a2a log must record which model answered, exactly
  // like any other channel, or the thread viewer shows the reply with no model.
  return { text: result.text, usage: result.usage, model: result.model || modelId };
}

/**
 * Run one A2A turn against a RUNTIME: spawn the CLI and read its answer.
 *
 * `resumeSessionId` is the whole point. A runtime that continues its own
 * session already lived through the earlier turns, so nothing is replayed and
 * nothing is re-read — the exchange costs one message, not one transcript.
 * A thread with no session on record (a runtime that can't keep one, or a first
 * turn) gets the history carried in the prompt instead, so it is never amnesic.
 */
export async function replyAsRuntime({
  peer,
  fromAddress,
  body,
  config,
  history = [],
  cwd,
  projectName = "",
  resumeSessionId = null,
  timeoutMs = 5 * 60 * 1000,
  mode = "chat",
}) {
  const rt = getRuntime(peer.runtime);
  const system = buildA2APeerSystem({
    projectName,
    peer,
    selfAddress: peer.address,
    peerAddress: fromAddress,
    config,
    mode,
  });
  const carried = resumeSessionId ? "" : flattenHistory(history);
  const prompt = [carried, `From ${fromAddress}:\n\n${body}`].filter(Boolean).join("\n\n---\n\n");

  const startedAt = Date.now();
  const r = await rt.run({
    system,
    prompt,
    cwd,
    timeoutMs,
    sessionKey: a2aSessionKey(fromAddress, peer.address),
    resumeSessionId,
    mode,
  });

  // A killed process can outlive its own SIGTERM, so "did we reach the
  // deadline", not "how long did we wait".
  const timedOut = Date.now() - startedAt >= timeoutMs;
  const failure = runtimeLooksLikeFailure(r, {
    timedOut,
    timeoutS: Math.round(timeoutMs / 1000),
  });
  if (failure.failed) {
    throw new Error(`${peer.runtime} did not answer: ${failure.reason}`);
  }

  return {
    text: r.output,
    // attribution-exempt: an external CLI spends its own tokens on its own
    // model; APX made no model call here and has nothing truthful to record.
    usage: null,
    model: null,
    runtime: peer.runtime,
    mode,
    sessionId: r.sessionId || resumeSessionId || null,
    // Why there is no session, when there is none — a null the caller can
    // explain beats a null it can only report.
    sessionNote: r.sessionId || resumeSessionId ? null : r.sessionNote || null,
  };
}

/** One turn against whichever kind of peer this is. The caller logs the result
 *  the same way for both — that sameness is the point of the split living here
 *  rather than in the route. */
export async function replyToPeer({ peer, ...rest }) {
  if (peer.kind === "runtime") return replyAsRuntime({ peer, ...rest });
  return replyAsAgent({
    ...rest,
    toAgent: peer.agent,
    selfAddress: peer.address,
    peerAddress: rest.fromAddress,
  });
}
