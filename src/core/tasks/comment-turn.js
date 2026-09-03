// Comments on a task that can summon an agent.
//
// A comment thread is the one place where "who should do this" and "what is
// this" sit together, so @-mentioning an agent there is the cheapest way to
// hand work over: drop a card in QA, tag @qa, and it does the QA and writes
// back what it found. The reply lands as another comment on the same task.
//
// TURN-TAKING IS THE GROUP CHAT'S, ON PURPOSE. `parseMentions` is imported from
// agent/group/turn-resolver.js rather than copied, and the cascade below is the
// same shape: an agent's reply is scanned for mentions, whoever is named gets a
// turn, and a ceiling stops the ping-pong. What is NOT reused is the seeding —
// a group with no mention hands the turn to the first agent in the room, and a
// comment with no mention must summon nobody. A note to self is a note to self.
//
// The ceiling is lower than the group's ten. A room is watched live by the
// person who opened it; a task thread runs unattended — that is the entire
// point of leaving work for QA — so the blast radius of a mention loop is a
// number nobody is sitting there to stop.
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { groupToolIters } from "#core/agent/constants.js";
import { parseMentions } from "#core/agent/group/turn-resolver.js";
import { runAgentTurn } from "#core/agent/run-turn.js";
import { readAgents } from "#core/apc/parser.js";
import { CHANNELS } from "#core/constants/channels.js";
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";
import { emitMessageEvent } from "#core/events/bus.js";
import { addComment, getTask } from "#core/stores/tasks.js";
import { nowIso } from "#core/util/time.js";

/** One comment can produce at most this many agent replies, cascade included. */
export const MAX_COMMENT_TURNS = 4;

/** Keep a reply readable in a side panel — see the "no huge deploy" rule below. */
const REPLY_CHAR_HINT = 700;

const displayName = (a) => a.fields?.Name || a.slug;

/**
 * Everyone addressable on a task in this project: the owner (who can be named
 * but never summoned) plus every agent the project declares.
 */
export function taskParticipants(projectPath) {
  let agents = [];
  try { agents = readAgents(projectPath); } catch { agents = []; }
  return [
    { slug: OWNER_ACTOR_ID, name: "Owner", kind: "owner" },
    ...agents.map((a) => ({ slug: a.slug, name: displayName(a), kind: "agent" })),
  ];
}

/**
 * Agent slugs a comment addresses. Exported so the API can resolve them at
 * WRITE time and store them on the comment — the roster can change, and the
 * thread should keep saying who was actually pulled in that day.
 */
export function mentionedAgents(text, projectPath, authorSlug = OWNER_ACTOR_ID) {
  return parseMentions(text || "", taskParticipants(projectPath), authorSlug);
}

/** The task, rendered for a model that has never seen it. */
function taskBlock(task, projectName) {
  const lines = [
    "## Task",
    `**${task.title}**`,
    `id: ${task.id} · project: ${projectName} · state: ${task.state} · status: ${task.status}`,
  ];
  if (task.due) lines.push(`due: ${task.due}`);
  if (task.agent) lines.push(`assigned: @${task.agent}`);
  if (task.tags?.length) lines.push(`tags: ${task.tags.map((t) => `#${t}`).join(" ")}`);
  if (task.subtask_count) lines.push(`subtasks: ${task.subtask_done}/${task.subtask_count} done`);
  if (task.description) lines.push("", "### Description", task.description);
  // The agent prompt is instructions for whoever RUNS the task, so a summoned
  // agent needs it. It is not the description and must not be read as one.
  if (task.body) lines.push("", "### Agent prompt (instructions for running this task)", task.body);
  return lines.join("\n");
}

/** The thread so far, oldest first, prefixed by speaker. */
function threadBlock(task, nameFor) {
  if (!task.comments?.length) return "";
  return [
    "",
    "## Comments",
    ...task.comments.map((c) => `${nameFor(c.by)}: ${c.text}`),
  ].join("\n");
}

function systemBlock({ me, others, taskTitle }) {
  const roster = others.length ? others.map((o) => `${o.name} (@${o.slug})`).join(", ") : "(no other agents)";
  return [
    "## Task comments",
    `You were @-mentioned in the comment thread of the task **${taskTitle}**.`,
    `Reply ONLY as yourself (**${me}**). Your reply is posted as a comment on that task — it is not a chat message.`,
    "**Do the work first.** You have your real tools. If the comment asks you to check, review, test or fix something, do it and report what you actually found. Do not describe what you would do.",
    `**Be short.** A comment lives in a side panel next to the task. Aim for a few lines and stay under ~${REPLY_CHAR_HINT} characters. If the detail is long, put the conclusion in the comment and the detail where it belongs (a file, a PR, the task's description).`,
    `**Handing work over:** the only way another agent gets a turn is writing their exact handle with an @ — ${roster}. Writing just their name does NOT reach them. Mention someone ONLY if they genuinely need to act; if you can close it yourself, cite nobody and the thread ends.`,
  ].join("\n");
}

/**
 * Record an agent→agent handover on the a2a ledger, so a crossing that happened
 * inside a task still shows up where every other agent-to-agent exchange does.
 * The work itself already ran through the real turn engine — this is the paper
 * trail, not the delivery mechanism (an a2a `--deliver` reply has no tools).
 */
function logHandover(p, { from, to, taskId, text, model, usage }) {
  const ts = nowIso();
  // Attribution rides along: a row filed without `model`/`usage` reopens in the
  // viewer as "0 tok, no model", which is the regression tests/message-
  // attribution.test.js exists to stop. The numbers are the summoned agent's
  // own turn — the one whose reply this row mirrors.
  const meta = {
    task: taskId, via: "task_comment",
    ...(model ? { model } : {}), ...(usage ? { usage } : {}),
  };
  try {
    p.logMessage({
      agent_slug: from, channel: CHANNELS.A2A, direction: "out",
      author: from, body: text, meta: { ...meta, to, final: true }, ts,
    });
    p.logMessage({
      agent_slug: to, channel: CHANNELS.A2A, direction: "in",
      author: from, body: text, meta: { ...meta, from }, ts,
    });
  } catch {
    // The comment is the source of truth; a missing mirror row must never fail
    // the turn that produced it.
  }
}

/** The real thing: one summoned agent's turn, with its own tools. */
async function runRealTurn({
  p, agent, slug, from, task, participants, nameFor, projectName,
  cfg, projects, plugins, registries, signal,
}) {
  const modelId = await resolveAgentModel({ agent, config: cfg });
  if (!modelId) throw new Error(`no model for agent ${slug}`);
  const me = displayName(agent);
  const others = participants.filter((x) => x.kind === "agent" && x.slug !== slug);
  const system = buildAgentSystem(p, agent, {
    invocation: "engine",
    caller: from === OWNER_ACTOR_ID ? "user" : from,
    globalConfig: cfg,
    extraParts: [systemBlock({ me, others, taskTitle: task.title })],
  });
  const directive = from === OWNER_ACTOR_ID
    ? `The owner tagged you (@${slug}) on this task. Act on the last comment, then reply.`
    : `${nameFor(from)} tagged you (@${slug}) on this task. Act on the last comment, then reply.`;

  const result = await runAgentTurn({
    p, agent, modelId, system,
    prompt: `${taskBlock(task, projectName)}${threadBlock(task, nameFor)}\n\n---\n${directive}`,
    previousMessages: [],
    channel: CHANNELS.WEB,
    // Same reasoning as the group: the channel picks the PROMPT, but one comment
    // can fan out into several of these runs, so the budget is the fan-out-aware
    // one.
    maxIters: groupToolIters(cfg),
    tools: true,
    projects, plugins, registries, config: cfg,
    signal,
  });
  return { text: result.text || "", model: result.model || modelId, usage: result.usage };
}

/**
 * Run the mention cascade for the newest comment on a task.
 *
 * Fire-and-forget from a route: every reply is persisted as it lands, so a
 * caller that never awaits still gets the full thread on its next read.
 *
 * @param {object} args
 * @param {object} args.p         resolved project (path, storagePath, config, logMessage, id)
 * @param {string} args.taskId
 * @param {string[]} args.seed    agent slugs the triggering comment mentioned
 * @param {string} args.author    who wrote the triggering comment (owner | agent slug)
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.runTurn]
 *        Injectable model call, same trick the group resolver uses: the cascade
 *        and its ceiling are the part worth testing, and neither needs an
 *        engine. Production always uses the real turn.
 * @returns {Promise<Array<{slug, text}>>}
 */
export async function runCommentMentions({
  p, taskId, seed, author = OWNER_ACTOR_ID,
  projects, plugins, registries, config, signal = null,
  maxTurns = MAX_COMMENT_TURNS,
  runTurn = runRealTurn,
}) {
  const participants = taskParticipants(p.path);
  const agents = new Map();
  try {
    for (const a of readAgents(p.path)) agents.set(a.slug, a);
  } catch { /* no roster → nothing to summon */ }

  const nameFor = (who) =>
    !who || who === OWNER_ACTOR_ID ? "Owner" : (agents.get(who) ? displayName(agents.get(who)) : who);

  const cfg = p.config || config;
  const projectName = p.name || p.path || String(p.id);
  const said = [];
  const queue = (seed || []).filter((s) => agents.has(s)).map((slug) => ({ slug, from: author }));

  while (queue.length && said.length < maxTurns) {
    if (signal?.aborted) break;
    const { slug, from } = queue.shift();
    const agent = agents.get(slug);
    if (!agent) continue;

    // Re-read every hop: an earlier speaker's comment is already persisted, so
    // the next one sees what was just said.
    const task = getTask(p.storagePath, taskId);
    if (!task) break;

    let reply = "";
    let model = null;
    let usage = null;
    try {
      // A test's stub may hand back a bare string; the real one returns what
      // answered and what it spent.
      const out = await runTurn({
        p, agent, slug, from, task, participants, nameFor, projectName,
        cfg, projects, plugins, registries, signal,
      });
      if (typeof out === "string") reply = out.trim();
      else { reply = (out?.text || "").trim(); model = out?.model || null; usage = out?.usage || null; }
    } catch (e) {
      // A failed summon is written into the thread rather than swallowed: a
      // comment that says "@qa" and is met with silence looks like the feature
      // is broken, which is worse than reading why it did not run.
      reply = `⚠️ No pude atender la mención: ${e?.message || String(e)}`;
    }

    if (!reply) reply = "…";
    const next = parseMentions(reply, participants, slug);
    addComment(p.storagePath, taskId, { by: slug, text: reply, mentions: next });
    said.push({ slug, text: reply });
    // attribution-exempt: this is the live-feed SIGNAL, not a ledger insertion.
    // It carries "the thread moved" and nothing else — the row it announces was
    // written by addComment above, and the a2a mirror below is where the model
    // and usage are recorded.
    emitMessageEvent({
      scope: "project", channel: CHANNELS.A2A, project_root: p.storagePath,
      agent_slug: slug, direction: "out", type: "agent", thread: taskId, final: true,
      ts: nowIso(),
    });

    for (const to of next) {
      if (!agents.has(to)) continue;
      if (queue.some((q) => q.slug === to)) continue;
      logHandover(p, { from: slug, to, taskId, text: reply, model, usage });
      queue.push({ slug: to, from: slug });
    }
  }

  return said;
}
