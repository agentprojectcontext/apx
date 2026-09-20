import { createAgent } from "#core/apc/agent-write.js";
import { readAgents } from "#core/apc/parser.js";
import { slugifyName } from "#core/stores/organization.js";
import { projectMeta, resolveProject } from "../helpers.js";

// A NAME IS A PERSON; the job goes in `role`.
//
// Left to itself a model writes the slug back out in title case — it created
// `productor-reels` and called it "Productor Reels", `savia-agent` and called
// it nothing at all — so the panel says the address twice and the group chat
// heads a bubble with a filename. The vault importer never had this problem:
// its role templates ship no persona, and the install gives each one a name
// out of the pool with the job beside it ("Nora · Chief Financial Officer").
//
// So a name that is only the slug spelled out is read as what it actually is:
// the ROLE. It is kept (nothing the model wrote is thrown away) and the agent
// is named by the same pool the importer draws from. Single-word slugs are
// left alone — `romi`/"Romi" is a person whose handle happens to match, which
// is the normal shape of an agent somebody named on purpose.
function demoteSlugEcho(args) {
  const name = String(args.name || "").trim();
  const slug = String(args.slug || "");
  if (!name || !/[-_]/.test(slug) || slugifyName(name) !== slug) return args;
  return { ...args, name: null, role: args.role || name };
}

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
        "Create a project agent (a specialist persona) WITH its system prompt in one step. Use this — not run_shell/apx agent add, and never write_file on the .md — whenever the user asks you to make a new agent. `system` is the agent's full instructions (its reason to exist) and is required. The agent is a PERSON: `name` is a first name (Luis, Karla), `role` is the job, `description` is one line about it — never fold the job into the name. Leave `name` out and APX names it for you. An `area` that does not exist yet is created. Omit `tools` unless you deliberately want to narrow the agent (an undeclared tools field means the broad default). Project resolves by id/name/path; omit to create it in the project you belong to (that is the 'default' workspace when you are the super-agent). Call list_agents first if unsure what exists.",
      parameters: {
        type: "object",
        required: ["slug", "system"],
        properties: {
          project:     { type: "string", description: "Project id, name or path. Omit for the project you belong to (the default project, if you are the super-agent)." },
          slug:        { type: "string", description: "Lowercase id: starts with a letter, then letters/digits/-/_ (e.g. golf-coach)." },
          system:      { type: "string", description: "The agent's full system prompt / instructions. REQUIRED — this is what the agent does, how, and what it never does." },
          name:        { type: "string", description: "The agent's NAME — a person's name, like Luis or Karla. NOT its job: 'Productor Reels' is a role, not a name. Omit it and APX picks one nobody on this machine is using." },
          role:        { type: "string", description: "What it IS, one line, e.g. 'Golf coach' or 'Productor de reels'. This is where the job title goes." },
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
      p = resolveProject(projects, project);
    } catch (e) {
      return { error: e.message };
    }
    try {
      createAgent(p, demoteSlugEcho(args), { requireSystem: true });
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === slug);
      return {
        ok: true,
        agent: created?.slug || slug,
        // The name it ended up with — which is not always the one that was
        // asked for, so the answer has to say it rather than leave the model
        // addressing an agent by a name nobody else uses.
        name: created?.fields?.Name || null,
        project: projectMeta(projects, p),
        role: created?.fields?.Role || args.role || null,
        skills: created?.fields?.Skills || args.skills || [],
        hint: "Agent created with its system prompt. Call it by its `name` from now on (the slug is only its address). Seed its memory with write_agent_memory if it should track progress across runs.",
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};
