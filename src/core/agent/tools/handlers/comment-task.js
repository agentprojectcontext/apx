import { addComment, getTask } from "#core/stores/tasks.js";
import { requestDecision, resolveDecision } from "#core/tasks/decisions.js";
import { mentionedAgents, summonFromAgentComment } from "#core/tasks/comment-turn.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";

// Leave a comment on a task. The write-up half of working on one: an agent that
// reviewed, tested or fixed something says so where the task is, instead of the
// result living only in a chat nobody will scroll back to.
//
// A MENTION HERE HANDS THE TASK ON. It used to summon nobody, which left the
// hand-off the prompt asks for ("work for another agent is a task — comment on
// it mentioning them") landing nowhere until the other agent happened to look.
// Now the mentioned agent gets a turn, off this one (the caller does not wait),
// under the walls in core/tasks/comment-turn.js summonFromAgentComment: no
// second cascade on a thread that already has one running, and a ceiling of
// turns per task per hour. The result says which happened.
async function askOnTask({ projects, project, task, decision, channelMeta, globalConfig, plugins, registries }) {
  let p;
  try { p = resolveProject(projects, project); } catch (e) { return { error: e.message }; }
  const by = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
  try {
    const out = await requestDecision({
      storagePath: p.storagePath, taskId: task, by, plugins, config: globalConfig,
      projectId: p.id ?? null, projectName: p.name || null,
      fields: {
        question: decision.question,
        options: decision.options,
        recommendation: decision.recommendation,
        responsible: decision.responsible || undefined,
        blocking: decision.blocking,
        can_continue: decision.can_continue,
      },
      summon: (mentions) => summonFromAgentComment({
        p, taskId: getTask(p.storagePath, task)?.id || task, mentions, author: by,
        projects, plugins, registries, config: globalConfig,
      }),
    });
    if (!out) return { error: `task not found: ${task}` };
    return {
      ok: true,
      project: projectMeta(projects, p),
      decision: { id: out.decision.id, responsible: out.decision.responsible },
      ...(out.notice ? { notice: out.notice } : {}),
      ...(out.summoned ? { summoned: out.summoned.summoned } : {}),
      note:
        "The question is on the card. Do not repeat it in prose or ask again; the answer comes back to you " +
        "as a comment naming this decision. Keep working on what does not depend on it.",
    };
  } catch (e) {
    return { error: e.message };
  }
}

export default {
  name: "comment_task",
  schema: {
    type: "function",
    function: {
      name: "comment_task",
      description:
        "Add a comment to a task's thread. Use it to report what you found or did while working on a " +
        "task — a QA verdict, a review note, what is blocking you — so it stays attached to the task " +
        "instead of only in this conversation. Keep it to a few lines: it renders in a side panel next " +
        "to the task. Call list_tasks first if you do not have the task id. " +
        "When you NEED A DECISION, pass `decision` instead of writing 'NEEDS USER INPUT' in prose: it " +
        "becomes a question on the card (options, recommendation, who decides, what is blocked, what can " +
        "go on), the owner is notified once, and the answer comes back to you. Put a correction another " +
        "agent owes under THAT agent as `responsible`, not the owner. If a decision is addressed to you, " +
        "answer it with `answers_decision` + `text`.",
      parameters: {
        type: "object",
        required: ["task"],
        properties: {
          task:    { type: "string", description: "Task id or unique id prefix (≥3 chars)." },
          text:    { type: "string", description: "The comment. A few lines. Lead with the conclusion." },
          project: { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          decision: {
            type: "object",
            description: "Ask for a decision. `text` may be omitted; the question is rendered on the thread.",
            required: ["question"],
            properties: {
              question:       { type: "string", description: "One concrete question." },
              options:        { type: "array", items: { type: "string" }, description: "The choices, if it is a choice." },
              recommendation: { type: "string", description: "What you recommend and its trade-off." },
              responsible:    { type: "string", description: "Who decides: owner (default) or an agent slug." },
              blocking:       { type: "string", description: "What cannot proceed until this is answered." },
              can_continue:   { type: "string", description: "What can go on meanwhile." },
            },
          },
          answers_decision: { type: "string", description: "Id of a decision addressed to YOU; `text` is your answer." },
        },
      },
    },
  },
  makeHandler: ({ projects, channelMeta, globalConfig, plugins, registries }) => async (args = {}) => {
    const { task, text, project, decision, answers_decision: answersDecision } = args;
    if (!task) return missingArg("comment_task", "task", { required: ["task", "text"], optional: ["project"] }, args);
    if (decision && typeof decision === "object") {
      return askOnTask({ projects, project, task, decision, channelMeta, globalConfig, plugins, registries });
    }
    if (!text || !String(text).trim()) {
      return missingArg("comment_task", "text", { required: ["task", "text"], optional: ["project"] }, args);
    }

    let p;
    try {
      p = resolveProject(projects, project);
    } catch (e) {
      return { error: e.message };
    }

    try {
      // Whoever is running this turn signs the comment. Falling back to a
      // generic id would make every agent's notes indistinguishable in a thread
      // whose entire value is knowing who said what.
      const by = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
      if (answersDecision) {
        const out = resolveDecision({
          storagePath: p.storagePath, taskId: task, decisionId: String(answersDecision), answer: String(text), by,
          handBack: (asker, author) => summonFromAgentComment({
            p, taskId: getTask(p.storagePath, task)?.id || task, mentions: [asker], author,
            projects, plugins, registries, config: globalConfig,
          }),
        });
        if (!out) return { error: `task not found: ${task}` };
        return {
          ok: true,
          project: projectMeta(projects, p),
          decision: { id: out.decision.id, state: out.decision.state },
          note: out.handed_back_to
            ? `Answered; ${out.handed_back_to} was handed the answer. The task itself is not approved by this.`
            : "Answered. The task itself is not approved by this.",
        };
      }
      const mentions = mentionedAgents(text, p.path, by, globalConfig);
      const result = addComment(p.storagePath, task, { by, text, mentions });
      if (!result) return { error: `task not found: ${task}` };
      const summon = mentions.length
        ? summonFromAgentComment({
            p, taskId: result.id, mentions, author: by,
            projects, plugins, registries, config: globalConfig,
          })
        : null;
      return {
        ok: true,
        project: projectMeta(projects, p),
        task: { id: result.id, title: result.title, comments: result.comments.length },
        ...(mentions.length
          ? {
              mentions,
              summoned: summon.summoned,
              note: summon.summoned.length
                ? `Handed on: ${summon.summoned.join(", ")} will take it up in their own turn and reply on the task. Do not wait for it here.`
                : summon.skipped === "cascade_running"
                  ? "Recorded. This task already has agents working on its thread; they read this comment there — nobody new was started."
                  : summon.skipped === "hourly_cap"
                    ? "Recorded, but this task has had its hourly share of agent turns; the mentioned agent reads it on their next turn."
                    : "Recorded on the comment.",
            }
          : {}),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
