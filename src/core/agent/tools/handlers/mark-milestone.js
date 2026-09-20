import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import {
  startMilestone,
  closeMilestone,
  listMilestones,
  MILESTONE_STATES,
} from "#core/stores/milestones.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

/**
 * Say what just changed about the shape of the work.
 *
 * WHY THE AGENT DECLARES THIS INSTEAD OF SOMETHING INFERRING IT. A chat that
 * ran forty turns has a spine — asked, analysed, rendered, delivered — and
 * reconstructing it afterwards from two hundred tool rows is guesswork that
 * costs a model call every time somebody opens the view. The agent is the only
 * party that knows, at the moment it happens, that a phase ended. So it says
 * so, and the record is a fact rather than a reconstruction.
 *
 * THE DEFAULT IS `done` ON PURPOSE. Almost every step is recorded once it is
 * already over — you notice you finished analysing the material as you finish
 * analysing it — and a default of `open` would fill the store with steps nobody
 * ever closed. `open` is for work genuinely still running, and `failed` is the
 * one that matters most: a timeline that only records what worked cannot answer
 * the question it exists for.
 *
 * Every call hands back the still-open milestones of this chat, which is what
 * makes closing one from a LATER turn possible without a second tool to look
 * them up. The ids arrive for free on the call before.
 */
export default {
  name: "mark_milestone",
  schema: {
    type: "function",
    function: {
      name: "mark_milestone",
      description:
        "Record one step of the work so the chat has a followable timeline — 'Reel analysed', " +
        "'Render finished', 'Blocked on the missing audio'. Call it when a PHASE changes, not per " +
        "tool call and not per message: three to six steps for an afternoon of work is right, " +
        "thirty is noise. Default state is 'done' (a step is usually recorded once it is over); " +
        "use 'open' for work still running and 'failed' when it did not work — recording a failure " +
        "is the point, it is what tells the owner something was left half-finished. " +
        "Pass `milestone` (an id from a previous call's open_milestones) to close one you opened " +
        "earlier instead of starting a new one. Use `track` to group steps belonging to the same " +
        "piece of work. Do not ask permission to record a step — record it and carry on.",
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          title: { type: "string", description: "The step, in one short line, past tense: 'Reel analysed', 'Voiceover rendered'. Required when opening; ignored when `milestone` names an existing one." },
          state: { type: "string", enum: [...MILESTONE_STATES], description: "done (default — it finished and worked) | open (still running) | failed (it did not work) | dropped (filed by mistake; NOT the same as failed)." },
          track: { type: "string", description: "Optional group these steps belong to — the piece of work, e.g. 'September reel'. Steps sharing a track render together." },
          detail: { type: "string", description: "Optional couple of sentences a reader can expand: what was produced, where it landed." },
          note: { type: "string", description: "Optional note recorded with the outcome. On `failed`, say what went wrong — this is the line the owner reads." },
          milestone: { type: "string", description: "Id (or >=3-char unique prefix) of a milestone from a previous call's open_milestones, to close it rather than open a new one." },
        },
      },
    },
  },
  makeHandler: (ctx) => async (args = {}) => {
    const { projects, channel, channelMeta } = ctx;
    const { project, title, state, track, detail, note, milestone } = args;

    if (state && !MILESTONE_STATES.includes(state)) {
      return { error: `unknown state "${state}" (use ${MILESTONE_STATES.join("|")})` };
    }
    if (!milestone && !title) {
      return missingArg(
        "mark_milestone",
        "title",
        { required: ["title"], optional: ["project", "state", "track", "detail", "note", "milestone"] },
        args
      );
    }

    let p;
    try {
      p = resolveProject(projects, project);
    } catch (e) {
      return { error: e.message };
    }

    const conversationId = channelMeta?.conversation_id || null;
    // Who is speaking, decided the way every other tool decides it: a project
    // agent's turn stamps its slug on the context and the super-agent's does
    // not. Never taken from an argument — a caller that can name the author can
    // file work under somebody else's name.
    const agent = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;

    try {
      let row;
      if (milestone) {
        const outcome = state && state !== "open" ? state : "done";
        row = closeMilestone(p.storagePath, milestone, outcome, note || null);
        if (!row) return { error: `milestone not found: ${milestone}` };
      } else {
        row = startMilestone(p.storagePath, {
          title,
          track: track || null,
          detail: detail || null,
          state: state || "done",
          note: note || null,
          channel: channel || null,
          conversation_id: conversationId,
          thread_id: channelMeta?.thread_id || channelMeta?.chatId || null,
          agent,
          created_by: agent,
        });
      }

      return {
        ok: true,
        milestone: {
          id: row.id,
          title: row.title,
          state: row.state,
          track: row.track,
        },
        project: projectMeta(projects, p),
        // Handed back on every call so a later turn can close one of these
        // without a second tool to go and look the ids up.
        open_milestones: listMilestones(p.storagePath, {
          state: "open",
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }).map((m) => ({ id: m.id, title: m.title, started_at: m.started_at })),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
