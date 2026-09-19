import { resolveProject } from "../helpers.js";

export default {
  name: "call_mcp",
  schema: {
    type: "function",
    function: {
      name: "call_mcp",
      description: "Call a tool on an MCP server registered in default or a project. Args is a JSON object.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          mcp: { type: "string", description: "MCP server name" },
          tool: { type: "string", description: "tool name on that MCP" },
          args: { type: "object", description: "arguments object" },
        },
        required: ["mcp", "tool"],
      },
    },
  },
  // `call_mcp` carries NO dangerous flag, on purpose.
  //
  // It used to be graded per call: split the target tool's name into words and
  // look them up in two lists of English verbs and nouns, so `cheto_task_update`
  // was "dangerous" because it contains "update". Under `automatico` that means
  // a confirmation dialog, and a routine has nobody to show one to — so the
  // company-council-cmo run died on `cheto_task_update` with "Action requires
  // user confirmation", which was not true: nothing about that call needed a
  // person. Putting `call_mcp` in the routine's allowed_tools did not help
  // either, because `automatico` does not consult the allowlist at all.
  //
  // No wording of those lists fixes that. Guessing what a third-party tool does
  // from its name is the wrong instrument: the lists only know the words the
  // servers they were grown against happened to use, and every server that
  // names things differently gets graded by coincidence. The grade also had no
  // way to be right — a wrong "read" lets a write through, a wrong "write"
  // stops a routine, and the name carries no evidence either way.
  //
  // So APX grades its OWN tools, which it knows, and stops pretending to grade
  // somebody else's. An MCP call is bounded by the permission mode like any
  // other tool: `total` and `automatico` run it, `permiso` requires it in
  // allowed_tools. Which MCPs an agent can reach at all is decided upstream,
  // where it belongs — by what is registered in the project and what the
  // agent's tool list allows.
  makeHandler: ({ projects, registries, requirePermission }) => async ({ project, mcp, tool, args = {}, confirmed = false }) => {
    const p = resolveProject(projects, project);
    if (!registries) throw new Error("MCP registry unavailable");
    const registry = registries.for ? registries.for(p) : registries.ensure(p);

    await requirePermission("call_mcp", { confirmed, args: { mcp, tool } });

    return registry.call(mcp, tool, args);
  },
};
