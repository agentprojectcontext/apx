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
import { channelToolIters, MAX_TOOL_ITERS } from "#core/agent/constants.js";
import { judgeConfig, judgeCompletion, applyJudgeLoop, continuableTurn } from "#core/agent/judge.js";

// A chat reply is prose, not a Telegram one-liner: run-agent's 512-token default
// truncates an agent mid-answer on the surface where the whole answer is the
// point. Same headroom the routine runner gives itself.
export const AGENT_TURN_MAX_TOKENS = 4096;

/**
 * @returns {{text, trace, usage, model, allowedTools, media, endedAwaitingUser, judge?}}
 *   `media` is what the agent attached to THIS reply (attach_media). The caller
 *   delivers it and records it on the turn; an empty array means it sent none.
 *   `endedAwaitingUser` is true when the turn closed by asking the user
 *   something, so nobody answers on their behalf. `judge` is the verdict trail,
 *   present only when the completion judge actually scored the turn.
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
  // Left unset, the channel decides (channelToolIters). A project agent in the
  // web chat is on the same watched surface Roby is, and was stopping every 9
  // actions to ask whether to continue — the budget belongs to the surface, not
  // to which agent happens to be answering.
  maxIters,
  projects,
  plugins,
  registries,
  config,
  onEvent = null,
  onToken = null,
  requestConfirmation = null,
  // Cancellation. Without it a turn could only be stopped by not looking at it:
  // the caller's stream closing does not end the run (that is what lets another
  // tab catch up), so "stop" and "interrupt" both come down to signalling this.
  signal = null,
  // The completion judge, injectable so a test can supply verdicts without an
  // engine. Production always uses the real one.
  judgeCompletionFn = judgeCompletion,
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
      signal,
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
      // One model call, no tools, no loop: there is nothing here that could
      // have stopped halfway, and nothing that could have asked.
      endedAwaitingUser: false,
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

  // An explicit budget from the caller always wins; otherwise the surface's own
  // default applies. See channelToolIters.
  //
  // Resolved to a NUMBER, falling through to runAgent's own default rather than
  // leaving it unset, because this is the turn's total and the judge loop below
  // subtracts from it. "Whatever runAgent picks" is not a total you can share
  // between rounds. Same resolution runSuperAgent does.
  const turnMaxIters = (Number.isFinite(Number(maxIters)) && Number(maxIters) > 0
    ? Number(maxIters)
    : channelToolIters(cfg, channel)) || MAX_TOOL_ITERS;

  const hasImage = (attachments || []).some((a) => a?.data && /^image\//.test(a.mime || ""));
  // `iters` is what THIS pass may spend: the whole budget for the first run,
  // whatever is left for a judge round.
  const runOnce = (turnPrompt, history, iters = turnMaxIters) =>
    runAgent({
      globalConfig: cfg,
      system,
      prompt: turnPrompt,
      previousMessages: history,
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
      signal,
      maxIters: iters,
      onEvent,
      onToken,
    });

  let result = await runOnce(prompt, previousMessages);

  // Goal-completion judge — the same loop runSuperAgent runs, on the same
  // switch (`super_agent.judge.continue_unfinished`, on by default).
  //
  // A conversational turn ends when the model stops calling tools, which is
  // also what it does when it merely ANNOUNCES its next step ("ahora genero el
  // SRT") and writes no call: nothing is finished, nothing was asked, and the
  // task sits there until a person types "seguí". The super-agent has been
  // continued automatically since b071e70; every project agent was still
  // waiting to be poked, so Magui stalled in the web chat where Roby did not.
  //
  // EVERY CHANNEL a project agent answers on, not only the watched ones. The
  // failure is the model's, not the surface's — the announce-instead-of-act
  // turn reads identically on `api` and on `web` — and the two exclusions in
  // continuableTurn already spend the call where it pays: a turn that ran no
  // tools is chat (so "hola" never costs a judge call), and a turn that closed
  // by ASKING is waiting rather than unfinished, which is the regression
  // documented on continuableTurn — continuing it answers over the user's head
  // and re-asks the identical question.
  //
  // Those two make a channel gate redundant, because they already cut per
  // surface for the right reason. A bounded channel (api, and everything else
  // channelToolIters leaves alone) reserves its last iteration for the wrap-up,
  // so a turn that used its whole budget ends by asking and is excluded —
  // leaving only the turn that quit early, which is exactly the bug. The
  // run-to-completion surfaces (web, web_sidebar) have no wrap-up to fall back
  // on, so the judge is the only thing that notices — and there a human is
  // watching the tool calls render, one click from stopping the turn.
  //
  // Cost is one extra model call per JUDGED turn, and after those exclusions
  // the judged population is "ran real tools, then went quiet without asking
  // anything" — where a wasted scoring call is far cheaper than work that
  // stopped halfway and nobody noticed. The group cascade reaches this too: a
  // speaker that ran tools and went quiet is the same bug in a busier room.
  //
  // Not gated on `judge.enabled` — that switch guards the OTHER door, a
  // completion-contract turn's own "done" claim, which project agents never
  // take (no finish tool, no forced tool choice). An aborted turn is the user
  // saying stop, the one instruction a judge must not overrule.
  const jCfg = judgeConfig(cfg);
  if (jCfg.continue_unfinished && !signal?.aborted && continuableTurn(result)) {
    // Rolling refinement history: each round sees the original goal, its own
    // prior reply, and the judge's follow-up as ordinary conversation turns.
    const history = [...previousMessages, { role: "user", content: prompt }];
    result = await applyJudgeLoop({
      initialResult: result,
      cfg: jCfg,
      onEvent,
      // The turn's whole budget, shared with the run above rather than reissued
      // per round. See the "one turn, one budget" note in constants.js.
      maxIters: turnMaxIters,
      // The model that ran the turn is the judge's last-resort scorer: a
      // project agent can be the only agent an install has, and `judge.model` /
      // `super_agent.model` may both be unset.
      judgeFn: (r) => judgeCompletionFn({ goal: prompt, result: r, globalConfig: cfg, fallbackModel: modelId }),
      runFollowup: async (followup, prior, { maxIters: roundIters } = {}) => {
        history.push({ role: "assistant", content: prior.text || "" });
        const next = await runOnce(followup, [...history], roundIters);
        history.push({ role: "user", content: followup });
        return next;
      },
    });
  }

  return {
    text: result.text || "",
    trace: Array.isArray(result.trace) ? result.trace : [],
    usage: result.usage,
    model: result.model || modelId,
    allowedTools,
    // Accumulated across judge rounds by construction: the same sink is handed
    // to every round, so an image attached before the turn was continued still
    // reaches the caller.
    media: mediaSink,
    endedAwaitingUser: !!result.endedAwaitingUser,
    ...(result.judge ? { judge: result.judge } : {}),
  };
}
