// One turn of a project agent — THE shared turn engine, used by the 1:1 chat
// route (host/daemon/api/exec.js), the group cascade (agent/group), and anyone
// else who needs an agent to answer with its real tools.
//
// WHY THIS EXISTS (moved here from exec.js so it can be reused without a route
// importing from another route). This used to be `callEngine` and nothing else:
// system prompt in, text out, no tools anywhere — which is why an agent asked to
// browse answered with a fenced {"tool":"browser_navigate",…} instead of
// browsing. It had nothing to call, so narrating the call was the only move left
// to it. Now the same loop the routine runner uses runs here too, gated by the
// same `resolveAgentAllowedTools` — the agent's declared `tools:` field when it
// has one, the broad default when it does not.
//
// `tools: false` keeps the old shape for a caller that wants one model call and
// no side effects.
import { callEngine } from "#core/engines/index.js";
import { resolveAgentAllowedTools } from "#core/agent/agent-tools.js";
import { runAgent } from "#core/agent/index.js";
import { createToolSession, makeToolHandlers } from "#core/agent/tools/registry.js";
import { loadAgentSkills, collectAgentSkillMedia } from "#core/agent/skills/agent-skills.js";
import { scopeProjects } from "#core/apc/projects-helpers.js";

// A chat reply is prose, not a Telegram one-liner: run-agent's 512-token default
// truncates an agent mid-answer on the surface where the whole answer is the
// point. Same headroom the routine runner gives itself.
export const AGENT_TURN_MAX_TOKENS = 4096;

/**
 * @returns {{text, trace, usage, model, allowedTools, media}}
 *   `media` is what the agent attached to THIS reply (attach_media). The caller
 *   delivers it and records it on the turn; an empty array means it sent none.
 */
export async function runAgentTurn({
  p,
  agent,
  modelId,
  system,
  prompt,
  previousMessages = [],
  // Images that arrived with this turn: [{ kind, mime, data, path }]. Only the
  // tool-driven path forwards them — the toolless callEngine branch is text.
  attachments = [],
  channel,
  channelMeta,
  temperature,
  maxTokens,
  tools = true,
  maxIters,
  projects,
  plugins,
  registries,
  config,
  onEvent = null,
  onToken = null,
  requestConfirmation = null,
}) {
  const cap = Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : AGENT_TURN_MAX_TOKENS;

  if (tools === false) {
    const result = await callEngine({
      modelId,
      system,
      messages: [...previousMessages, { role: "user", content: prompt }],
      config: p.config || config,
      temperature,
      maxTokens,
    });
    return {
      text: result.text || "",
      trace: [],
      usage: result.usage,
      // What ANSWERED, which is not always what was resolved: routing can fall
      // back mid-turn, and the caller should be told which model replied.
      model: result.model || modelId,
      allowedTools: [],
      media: [],
    };
  }

  const cfg = structuredClone(p.config || config || {});
  // Deliberately NOT forcing permission_mode. A routine pins it to "total"
  // because a scheduled run has nobody to approve a dangerous tool; a chat has
  // a person on the other end, so the configured policy stands and a blocked
  // tool comes back to the model as an observation it can re-plan around.
  const allowedTools = resolveAgentAllowedTools(agent);
  // The allowlist decides WHAT it may call; the channel decides how much of it
  // is loaded up front — a full channel gets the lot, a lightweight one starts
  // on the base set and expands through discover_tools.
  const toolSession = createToolSession(channel, { allowedTools });

  // Images this agent's skills declare: the pool attach_media / view_media
  // validate an id against, and the sink a queued attachment lands in.
  //
  // These used to be supplied ONLY by the routine runner, so attach_media was
  // dead on every surface with a person on the other end: the same skills whose
  // image manifest build-agent-system.js had just rendered into the prompt were
  // not attachable, and the tool answered "no attachable images — this agent's
  // skills declare none" to a model that could see them listed. A skill's
  // picture is at its most useful mid-conversation, which was the one place it
  // could not be sent.
  const attachableMedia = collectAgentSkillMedia(loadAgentSkills(p, agent));
  const mediaSink = [];

  const hasImage = (attachments || []).some((a) => a?.data && /^image\//.test(a.mime || ""));
  const result = await runAgent({
    globalConfig: cfg,
    system,
    prompt,
    previousMessages,
    attachments,
    overrideModel: modelId,
    toolSchemas: toolSession.initialSchemas,
    makeToolHandlers,
    toolHandlerCtx: {
      // Same scoping as a routine run: this agent belongs to `p`, so that is
      // what an unqualified path means to it. See scopeProjects.
      projects: scopeProjects(projects, p.id),
      plugins,
      registries,
      globalConfig: cfg,
      channel,
      channelMeta: {
        ...(channelMeta || {}),
        ...(hasImage ? { has_image: true } : {}),
        agentSlug: agent.slug,
        projectPath: p.path,
      },
      toolSession,
      attachableMedia,
      mediaSink,
      requestConfirmation,
    },
    agentName: agent.slug,
    maxTokens: cap,
    ...(Number.isFinite(Number(maxIters)) ? { maxIters: Number(maxIters) } : {}),
    onEvent,
    onToken,
  });

  return {
    text: result.text || "",
    trace: Array.isArray(result.trace) ? result.trace : [],
    usage: result.usage,
    model: result.model || modelId,
    allowedTools,
    media: mediaSink,
  };
}
