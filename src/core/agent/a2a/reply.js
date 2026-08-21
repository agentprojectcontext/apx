// Agent-to-agent (A2A) one-shot reply: given a sender + recipient agent and a
// message body, build the recipient's system prompt and call the engine. Pure
// orchestration over core/agent + core/engines — no HTTP, no message log
// writes (the caller decides whether/where to persist).
import { callEngine } from "../../engines/index.js";
import { readAgentMemory } from "../memory.js";
import { resolveAgentModel } from "../agent-model.js";
import { readProfileState } from "../../profiles/store.js";

// The super-agent's own slug — the orchestrator that speaks to the owner.
const ORCHESTRATOR_SLUGS = new Set(["roby", "super_agent", "super-agent", "apx"]);

// a2a etiquette every recipient must follow. An a2a message is another AGENT
// talking, never the human owner — so a reply must not "answer the owner", and
// must not ping the owner directly. What reaches the owner, and when, is the
// orchestrator's (Roby's) call, through its own channel and quiet-hours.
function a2aEtiquette({ toSlug, config }) {
  const isOrchestrator = ORCHESTRATOR_SLUGS.has(String(toSlug || "").toLowerCase());
  const secretaryActive = readProfileState(config).active === "secretary";
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
      "You are NOT the orchestrator: if this needs the owner's attention or a decision, relay it to Roby (`apx send <you> roby \"…\" --deliver`) and let Roby decide how and when to tell them. Otherwise just do your part and reply here.",
    );
  }
  if (secretaryActive) {
    lines.push(
      "A secretary profile is active: anything promised to, owed to, or that the owner must act on has to be CAPTURED (a commitment via `record_commitment` / `apx commitment`, with a due date) so it resurfaces at the right time — a single a2a message is not a reminder and quiet-hours can swallow it.",
    );
  }
  return lines.join("\n");
}

/**
 * Build the recipient's system prompt for an A2A reply.
 * Includes Description, Role, Language, a persona line naming the sender,
 * the a2a etiquette (routing + secretary capture), and the recipient's memory.
 */
export function buildA2AReplySystem({ projectPath, toAgent, fromAgent, config }) {
  const tf = toAgent?.fields || {};
  const parts = [];
  if (tf.Description) parts.push(tf.Description);
  if (tf.Role) parts.push(`Role: ${tf.Role}`);
  if (tf.Language) parts.push(`Default language: ${tf.Language}`);
  parts.push(
    `You are ${toAgent.slug}. You just received a message from ${fromAgent.slug}. Reply concisely.`
  );
  parts.push(a2aEtiquette({ toSlug: toAgent.slug, config }));
  if (projectPath && toAgent.slug) {
    // Same file buildAgentSystem injects — an A2A turn must not read a
    // different memory than a normal turn, or the agent contradicts itself
    // depending on who asked.
    const memory = readAgentMemory(projectPath, toAgent.slug);
    if (memory) parts.push("## Memory\n" + memory);
  }
  return parts.join("\n\n");
}

/**
 * Run one A2A turn: build system, call engine, return { text, usage }.
 * Throws on engine failure — caller decides how to surface.
 */
export async function replyAsAgent({ projectPath, toAgent, fromAgent, body, config }) {
  const modelId = await resolveAgentModel({ agent: toAgent, config });
  if (!modelId) {
    throw new Error(
      `no model for agent ${toAgent?.slug || "?"} (no override, no router default)`
    );
  }
  const system = buildA2AReplySystem({ projectPath, toAgent, fromAgent, config });
  const result = await callEngine({
    modelId,
    system,
    messages: [{ role: "user", content: `From ${fromAgent.slug}:\n\n${body}` }],
    config,
  });
  // Return the model too: the a2a log must record which model answered, exactly
  // like any other channel, or the thread viewer shows the reply with no model.
  return { text: result.text, usage: result.usage, model: result.model || modelId };
}
