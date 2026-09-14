// A role gate that says so.
//
// The allowlist keeps a specialist out of the master-tier tools (rename_agent,
// remove_agent) by simply not offering them: they are absent from the agent's
// schema set and from the "tools you can activate" block, so the model normally
// never learns they exist. That is the right default — a refusal the model can
// see is a refusal it will argue with — but it also means the one case worth
// knowing about leaves no trace: an agent that goes looking for the delete
// button anyway, by name, gets a flat "not available to you" and the turn moves
// on. Manu's rule for anything an agent decided not to do (or could not) is to
// leave it somewhere he can go and look at it.
//
// So: `log`. Never a push channel — this is not urgent, and waking somebody to
// say "nothing happened" is the interruption the gate just prevented — and
// never the agent's web chat, where it would read as something the agent said.
// The Logs view is the place you go on purpose.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { isMasterOnlyTool } from "#core/agent/agent-tools.js";

/**
 * Record an agent reaching for tools its role does not carry.
 *
 * Only the ROLE-gated ones. A card narrowed to five tools denies dozens on
 * every turn and none of that is news — logging it would bury the one line that
 * matters under the ordinary work of the allowlist.
 *
 * @param {{id?:any, path?:string}} project
 * @param {{slug?:string, fields?:object, name?:string}} agent
 * @param {string[]} names  what the gate refused
 * @param {string} channel  where the turn was running
 */
export function noteDeniedTools(project, agent, names, channel = null) {
  const gated = (Array.isArray(names) ? names : []).filter(isMasterOnlyTool);
  if (!gated.length) return 0;
  const slug = agent?.slug || "?";
  const label = agent?.fields?.Name || agent?.name || slug;
  try {
    appendGlobalMessage({
      channel: CHANNELS.LOG,
      direction: "out",
      type: "system",
      author: "apx",
      body:
        `${label} (${slug}) intentó usar ${gated.join(", ")} y no le corresponde: ` +
        "esas tools son de orquestadores. No se ejecutó nada. " +
        "Si querés que pueda, ponelo como orquestador (type: orchestrator) en su ficha.",
      meta: {
        kind: "tool_denied",
        project_id: project?.id ?? null,
        agent_slug: slug,
        tools: gated,
        ...(channel ? { from_channel: channel } : {}),
      },
    });
    return gated.length;
  } catch {
    // A note nobody can write is not worth failing a turn over.
    return 0;
  }
}
