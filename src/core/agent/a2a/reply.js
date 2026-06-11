// Agent-to-agent (A2A) one-shot reply: given a sender + recipient agent and a
// message body, build the recipient's system prompt and call the engine. Pure
// orchestration over core/agent + core/engines — no HTTP, no message log
// writes (the caller decides whether/where to persist).
import fs from "node:fs";
import { callEngine } from "../../engines/index.js";
import { apcAgentMemoryFile } from "../../apc/paths.js";

/**
 * Build the recipient's system prompt for an A2A reply.
 * Includes Description, Role, Language, a persona line naming the sender,
 * and the recipient's memory.md if present.
 */
export function buildA2AReplySystem({ projectPath, toAgent, fromAgent }) {
  const tf = toAgent?.fields || {};
  const parts = [];
  if (tf.Description) parts.push(tf.Description);
  if (tf.Role) parts.push(`Role: ${tf.Role}`);
  if (tf.Language) parts.push(`Default language: ${tf.Language}`);
  parts.push(
    `You are ${toAgent.slug}. You just received a message from ${fromAgent.slug}. Reply concisely.`
  );
  if (projectPath && toAgent.slug) {
    const memPath = apcAgentMemoryFile(projectPath, toAgent.slug);
    if (fs.existsSync(memPath)) {
      parts.push("## Memory\n" + fs.readFileSync(memPath, "utf8"));
    }
  }
  return parts.join("\n\n");
}

/**
 * Run one A2A turn: build system, call engine, return { text, usage }.
 * Throws on engine failure — caller decides how to surface.
 */
export async function replyAsAgent({ projectPath, toAgent, fromAgent, body, config }) {
  if (!toAgent?.fields?.Model) {
    throw new Error(`agent ${toAgent?.slug || "?"} has no model`);
  }
  const system = buildA2AReplySystem({ projectPath, toAgent, fromAgent });
  const result = await callEngine({
    modelId: toAgent.fields.Model,
    system,
    messages: [{ role: "user", content: `From ${fromAgent.slug}:\n\n${body}` }],
    config,
  });
  return { text: result.text, usage: result.usage };
}
