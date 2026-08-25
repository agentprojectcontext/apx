// Run one full group turn: persist the owner's line, walk the mention cascade
// (turn-resolver.js), and for each speaker call the SAME turn engine the 1:1
// chat uses (run-turn.js) — so agents run their real tools instead of narrating
// them — streaming tokens back tagged by speaker. Everything persists to the
// message ledger via the group helpers (stores/messages.js); there is no
// separate group store.
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { runAgentTurn } from "#core/agent/run-turn.js";
import { readAgents } from "#core/apc/parser.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  appendGroupAgentMessage,
  appendGroupOwnerMessage,
  lastGroupOwnerMessage,
  readProjectGroupThread,
} from "#core/stores/messages.js";
import { resolveGroupTurn } from "./turn-resolver.js";

const displayName = (a) => a.fields?.Name || a.slug;

// System addendum that turns a normal agent into a group participant. No "you
// have no tools" line — in a group the agent keeps its real toolset; this only
// frames the room and the @-mention protocol.
function groupSystemBlock({ me, ownerName, others }) {
  const roster = others.length ? others.join(", ") : "(nadie más por ahora)";
  return [
    "## Group chat",
    `You are in a group chat with **${ownerName}** (the owner) and these other agents: ${roster}.`,
    "The conversation transcript is shown to you with each line prefixed by who said it.",
    `Reply ONLY as yourself (**${me}**), in your own voice, concisely. Never write anyone else's lines, and never speak for the owner.`,
    "**How to bring someone in:** the ONLY way another participant hears you and gets a turn is if you write their handle with an @ and their exact slug — e.g. `" + others.map((x) => x.match(/@[a-z0-9_-]+/)?.[0]).filter(Boolean).join("`, `") + "`. Writing just their NAME (without the @slug) does NOT reach them.",
    "@-mention another agent with their exact @slug only if they actually need to reply. If you can close the turn yourself, don't cite anyone. A short acknowledgement is fine — don't pad.",
  ].join("\n");
}

function reasonLine({ reason, byOwner, ownerName, nameFor, me }) {
  if (byOwner) return `${ownerName} addressed the group and it's your turn, ${me}. Reply now.`;
  return `${nameFor(reason)} tagged you (@${me}) into the conversation. Reply now.`;
}

/**
 * @param {object} args
 * @param {object} args.p          resolved project (db entry: path, storagePath, config, logMessage)
 * @param {string} args.gid        group id
 * @param {string} args.text       the owner's message body
 * @param {string} args.ownerName  display name for the owner in the transcript
 * @param {object} args.config     global config (fallback for the project's)
 * @param {object} args.projects   projects registry (for runAgentTurn tool handlers)
 * @param {object} [args.plugins]
 * @param {object} [args.registries]
 * @param {string} [args.from]     regenerate: slug of the speaker to resume from
 * @param {string|null} [args.reason] regenerate: who pulled that speaker in (null = owner)
 * @param {(ev:object)=>void} [args.onEvent] stream sink: owner_message/speaker_start/speaker_delta/speaker_final/done
 * @returns {Promise<{messages: object[]}>}
 */
export async function runGroupTurn({ p, gid, text, attachments = [], media = null, rerun = false, from = null, reason = null, ownerName = "Owner", config, projects, plugins, registries, onEvent = () => { } }) {
  const thread = readProjectGroupThread(p.storagePath, gid);
  if (!thread) throw new Error(`group ${gid} not found`);

  // Regenerate: reuse the LAST owner turn already in the thread (the caller
  // truncated from the target bubble onward), without appending a new owner
  // line. If `from` is set, resume the cascade at that speaker and leave
  // earlier replies this turn untouched.
  let resume = null;
  if (rerun) {
    const seed = lastGroupOwnerMessage(p.storagePath, gid);
    if (seed == null) throw new Error("nothing to regenerate: the group has no owner message yet");
    text = seed;
    if (from) {
      resume = {
        from,
        reason: reason || "owner",
        byOwner: !reason,
      };
    }
  }

  const roster = readAgents(p.path);
  const bySlug = new Map(roster.map((a) => [a.slug, a]));
  const agents = thread.participants.map((s) => bySlug.get(s)).filter(Boolean);
  if (!agents.length) throw new Error("group has no resolvable agents");
  if (from && !agents.some((a) => a.slug === from))
    throw new Error(`agent ${from} is not in this group`);

  const nameFor = (author) =>
    author === "owner" ? ownerName : (bySlug.get(author) ? displayName(bySlug.get(author)) : author);

  const participants = [
    { slug: "owner", name: ownerName, kind: "owner" },
    ...agents.map((a) => ({ slug: a.slug, name: displayName(a), kind: "agent" })),
  ];

  // The owner's line first, so it's part of the transcript everyone reads.
  // (A regenerate reuses the owner line already there — don't duplicate it.)
  if (!rerun) {
    appendGroupOwnerMessage(p.logMessage, gid, text, media);
    onEvent({ type: "owner_message" });
  }

  const cfg = p.config || config;
  const said = [];

  const runAgent = async (slug, ctx) => {
    const agent = bySlug.get(slug);
    const modelId = await resolveAgentModel({ agent, config: cfg });
    if (!modelId) throw new Error(`no model for agent ${slug}`);

    const me = displayName(agent);
    const others = participants
      .filter((x) => x.kind === "agent" && x.slug !== slug)
      .map((x) => `${x.name} (@${x.slug})`);
    const system = buildAgentSystem(p, agent, {
      invocation: "engine",
      caller: ctx.byOwner ? "user" : ctx.reason,
      globalConfig: cfg,
      extraParts: [groupSystemBlock({ me, ownerName, others })],
    });

    // Fresh read each time: earlier speakers this turn are already persisted, so
    // a later cascade speaker sees what was just said.
    const current = readProjectGroupThread(p.storagePath, gid);
    const transcript = current.messages
      .map((m) => `${m.role === "user" ? ownerName : (nameFor(m.agent) || "agent")}: ${m.content}`)
      .join("\n");
    const directive = reasonLine({ reason: ctx.reason, byOwner: ctx.byOwner, ownerName, nameFor, me });

    onEvent({ type: "speaker_start", slug, reason: ctx.byOwner ? null : ctx.reason });
    const result = await runAgentTurn({
      p, agent, modelId, system,
      prompt: `${transcript}\n\n---\n${directive}`,
      previousMessages: [],
      // The owner's image rides on this turn for every speaker answering it, so
      // a vision model actually sees what was sent (not just the "[image
      // attached]" marker already folded into the transcript text).
      attachments,
      channel: CHANNELS.WEB,
      tools: true,
      projects, plugins, registries, config: cfg,
      onEvent,
      onToken: (chunk) => onEvent({ type: "speaker_delta", slug, delta: chunk }),
    });

    const reply = (result.text || "").trim() || "…";
    appendGroupAgentMessage(p.logMessage, gid, {
      slug, body: reply,
      reason: ctx.byOwner ? null : ctx.reason,
      model: result.model, usage: result.usage,
      trace: result.trace,
    });
    said.push({ slug, text: reply });
    onEvent({ type: "speaker_final", slug, model: result.model || modelId, usage: result.usage });
    return reply;
  };

  await resolveGroupTurn({ text, participants, runAgent, resume });
  onEvent({ type: "done" });
  return { messages: said };
}
