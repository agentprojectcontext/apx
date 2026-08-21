import { createAgent } from "#core/apc/agent-write.js";
import { readAgents } from "#core/apc/parser.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Create a project agent — including its system prompt — in one call. This is
// what the super-agent should reach for instead of shelling out to
// `apx agent add` (which is awkward for a long, multi-line prompt) and then
// hand-writing the `.md` when the agent comes out body-less. `system` is
// required here on purpose: an agent without instructions cannot do anything.
export default {
  name: "create_agent",
  schema: {
    type: "function",
    function: {
      name: "create_agent",
      description:
        "Create a project agent (a specialist persona) WITH its system prompt in one step. Use this — not run_shell/apx agent add, and never write_file on the .md — whenever the user asks you to make a new agent. `system` is the agent's full instructions (its reason to exist) and is required. Omit `tools` unless you deliberately want to narrow the agent (an undeclared tools field means the broad default). Project resolves by id/name/path; omit or use 'default' for the super-agent workspace. Call list_agents first if unsure what exists.",
      parameters: {
        type: "object",
        required: ["slug", "system"],
        properties: {
          project:     { type: "string", description: "Project id, name or path. Omit or 'default' for ~/.apx/projects/default." },
          slug:        { type: "string", description: "Lowercase id: starts with a letter, then letters/digits/-/_ (e.g. golf-coach)." },
          system:      { type: "string", description: "The agent's full system prompt / instructions. REQUIRED — this is what the agent does, how, and what it never does." },
          name:        { type: "string", description: "Display name (optional; defaults to a title-cased slug)." },
          role:        { type: "string", description: "One-line role, e.g. 'Golf coach'." },
          description: { type: "string", description: "One line of metadata shown in listings. NOT a substitute for system." },
          model:       { type: "string", description: "Optional per-agent model override (else follows the project/global default)." },
          language:    { type: "string", description: "Default language code, e.g. 'es'." },
          skills:      { type: "array", items: { type: "string" }, description: "Skill slugs to attach (e.g. ['golf-lvl-2'])." },
          tools:       { type: "array", items: { type: "string" }, description: "Optional allowlist that NARROWS the agent. Omit for the broad default." },
          area:        { type: "string", description: "Org area slug/name (optional; call list_agents/org first)." },
          type:        { type: "string", description: "Agent typology (e.g. specialist, orchestrator)." },
          emoji:       { type: "string", description: "Optional emoji badge." },
          icon:        { type: "string", description: "Optional avatar blob key; one is picked if omitted." },
          is_master:   { type: "boolean", description: "Mark as a master/primary agent of the project." },
          parent:      { type: "string", description: "Parent agent slug, for hierarchy." },
          autonomy:    { type: "string", description: "Per-agent autonomy: total | automatico | permiso." },
        },
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async (args = {}) => {
    const { project, slug } = args;
    await requirePermission("create_agent", { dangerous: true, args: { agent: slug, project } });
    let p;
    try {
      p = resolveProject(projects, project || "default");
    } catch (e) {
      return { error: e.message };
    }
    try {
      createAgent(p, args, { requireSystem: true });
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === slug);
      return {
        ok: true,
        agent: created?.slug || slug,
        project: projectMeta(projects, p),
        role: created?.fields?.Role || args.role || null,
        skills: created?.fields?.Skills || args.skills || [],
        hint: "Agent created with its system prompt. Seed its memory with write_agent_memory if it should track progress across runs.",
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
