import { renameAgent, AGENT_SLUG_RE, agentSlugFromName } from "#core/apc/agent-write.js";
import { readAgents } from "#core/apc/parser.js";
import { missingArg, projectMeta, resolveProject } from "../helpers.js";

// Rename an agent the way the web does it — the display name AND the slug, plus
// the sweep that repoints every live reference to the old slug (child `Parent`,
// routines, group rosters, tasks, deliveries, code sessions, open background
// jobs, board hooks, telegram routes, the RAG scope).
//
// WHY A TOOL. Asked to "cambiale el nombre al orchestrator de postbeam", the
// super-agent had two bad options: `configure_agent({ name })`, which changes
// the label and leaves the slug — so the card reads one thing and every routine,
// room and task still names another — or a shell/write_file pass over
// `.apc/agents/<slug>.md`, which moves the file and breaks all of them at once.
// Both were reported as "renamed". This runs the exact same core function the
// route runs, so clicking the pencil in the UI and asking for it in a sentence
// are the same operation.
//
// Master-gated: see MASTER_ONLY_TOOLS in core/agent/agent-tools.js. Renaming
// somebody else's key is an orchestrator's job, not a specialist's.
export default {
  name: "rename_agent",
  schema: {
    type: "function",
    function: {
      name: "rename_agent",
      description:
        "Rename a project agent: its display name and/or its slug (the key that names its file, its memory dir and every routine, room, task and channel pointing at it). Moves the files and repoints every live reference in one step — the same thing the web's rename button does. Pass `name` to rename it the way a person would (the slug follows), or `slug` to move only the key. Never rename an agent by editing its .md with write_file or run_shell: that breaks every pointer.",
      parameters: {
        type: "object",
        required: ["agent"],
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          agent:   { type: "string", description: "CURRENT slug of the agent to rename (from list_agents)." },
          name:    { type: "string", description: "New display name, e.g. 'Orquestador'. The slug follows from it unless you also pass `slug`." },
          slug:    { type: "string", description: "New slug explicitly: lowercase letters, digits, - and _, starting with a letter. Omit to derive it from `name`." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, agent, name, slug } = {}) => {
    await requirePermission("rename_agent", { dangerous: true, args: { agent, name, slug, project } });
    const accepts = { required: ["agent"], optional: ["project", "name", "slug"] };
    if (!agent) return missingArg("rename_agent", "agent", accepts, { project, name, slug });
    const displayName = typeof name === "string" && name.trim() ? name.trim() : undefined;
    const rawSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "";
    if (!displayName && !rawSlug) {
      return missingArg("rename_agent", "name or slug", accepts, { project, agent });
    }

    let p;
    try {
      // No `|| "default"`: an unqualified rename means the project the CALLER
      // belongs to (resolveProject reads the scope run-turn.js sets), and only
      // falls back to the default project for the super-agent, which has none.
      p = resolveProject(projects, project);
    } catch (e) {
      return { error: e.message };
    }

    // One slugify, shared with the HTTP route, so a name typed in the web and a
    // name said to an agent land on the same key.
    const target = rawSlug || agentSlugFromName(displayName);
    if (!AGENT_SLUG_RE.test(target)) {
      return {
        error:
          `"${target}" is not a usable slug (lowercase letters, digits, - and _, starting with a letter). ` +
          "Pass `slug` explicitly.",
      };
    }
    // A taken slug is not something to paper over with a `-2` suffix nobody
    // asked for: say so and let the caller choose the name.
    if (target !== agent && readAgents(p.path).some((a) => a.slug === target)) {
      return { error: `agent ${target} already exists in this project — pick another name or pass an explicit \`slug\`.` };
    }

    try {
      const out = await renameAgent(p, agent, target, { projects: projects.list(), name: displayName });
      projects.rebuild(p.id);
      return {
        ok: true,
        project: projectMeta(projects, p),
        agent: { from: agent, slug: out.slug, name: out.name },
        // What actually moved, per store. Worth returning: "renamed" with three
        // routines and a room quietly repointed is a different answer to give
        // the user than "renamed" with nothing attached.
        repointed: Object.fromEntries(Object.entries(out.moved).filter(([, n]) => n > 0)),
        // Prose that still says the old name — a prompt, a memory. Deliberately
        // not rewritten (a slug is usually also an ordinary word), so it comes
        // back as a list for the caller to fix or mention.
        still_mentions: out.mentions.map((m) => ({
          where: m.kind, agent: m.agent, term: m.term,
        })),
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
