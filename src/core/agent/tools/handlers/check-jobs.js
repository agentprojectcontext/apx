import { listJobs } from "#core/stores/background-jobs.js";
import { jobStatus } from "#core/agent/a2a/in-flight.js";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";

// Read the work already left running — yours, or the whole install's. The way
// to answer "where is it?" without waking the agent doing it.
export default {
  name: "check_jobs",
  schema: {
    type: "function",
    function: {
      name: "check_jobs",
      description:
        "List work left running in the background (agents you handed work to, long commands) with what each is doing and for how long. " +
        "Use it to answer \"where did that get to?\" — calling the agent again would start the work over instead of reading its status.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "true: every open job on this install, not only the ones you started" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ channelMeta }) => ({ all = false } = {}) => {
    const from = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
    const jobs = listJobs({ open_only: true, ...(all ? {} : { from }) });
    // One level down, too: what the agents you are waiting on handed on
    // themselves, so a chain (you → a → b) reads as one piece of work.
    const direct = new Set(jobs.map((j) => j.to).filter(Boolean));
    const nested = all ? [] : listJobs({ open_only: true }).filter((j) => direct.has(j.from));
    return {
      open: jobs.length,
      jobs: jobs.map((j) => jobStatus(j)),
      ...(nested.length ? { handed_on_by_them: nested.map((j) => ({ from: j.from, ...jobStatus(j) })) } : {}),
    };
  },
};
