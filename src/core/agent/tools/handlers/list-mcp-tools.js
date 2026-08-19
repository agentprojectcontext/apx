import { resolveProject } from "../helpers.js";

// The catalog of ONE MCP server. `list_mcps` names the servers; without this
// the model knew a server called "postbean" existed and had no way to learn
// what it could ask it for. In practice it guessed tool names, got
// `Tool [tools] not found`, and then went reading the server's own source to
// reverse-engineer the contract — a dozen shell calls to recover something the
// protocol hands over in one request.
//
// Schemas are returned trimmed by default: names + one-line descriptions +
// required args are enough to pick a tool, and full JSON Schemas for a large
// server would swamp a chat turn. Ask for `detail: "full"` once the tool is
// chosen and the exact argument shape matters.
function oneLine(desc = "", cap = 200) {
  const flat = String(desc).replace(/\s+/g, " ").trim();
  return flat.length <= cap ? flat : flat.slice(0, cap - 1) + "…";
}

function briefTool(t) {
  const schema = t.inputSchema || t.input_schema || {};
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  return {
    name: t.name,
    description: oneLine(t.description),
    args: Object.keys(props),
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

export default {
  name: "list_mcp_tools",
  schema: {
    type: "function",
    function: {
      name: "list_mcp_tools",
      description:
        "List the tools an MCP server exposes, with their arguments. Call this " +
        "BEFORE call_mcp on a server you have not used this turn — it is how you " +
        "learn the tool names and argument shapes. Never guess an MCP tool name " +
        "and never read the server's source to find out; ask the server.",
      parameters: {
        type: "object",
        properties: {
          mcp: { type: "string", description: "MCP server name (from list_mcps)." },
          project: { type: "string", description: "Project id/name/path the MCP is registered in. Omit for default." },
          detail: {
            type: "string",
            enum: ["brief", "full"],
            description: "brief (default) = names, descriptions, arg names. full = complete JSON Schemas.",
          },
        },
        required: ["mcp"],
      },
    },
  },
  makeHandler: ({ projects, registries }) => async ({ mcp, project, detail } = {}) => {
    if (!mcp) return { error: "list_mcp_tools: mcp is required" };
    if (!registries) return { error: "MCP registry unavailable" };
    const p = resolveProject(projects, project);
    const registry = registries.for ? registries.for(p) : registries.ensure(p);

    const known = registry.list?.() || [];
    if (known.length && !known.some((m) => m.name === mcp)) {
      return {
        error: `MCP "${mcp}" is not registered here`,
        available: known.map((m) => m.name),
      };
    }

    let result;
    try {
      result = await registry.listTools(mcp);
    } catch (e) {
      return { error: `MCP "${mcp}" tools/list failed: ${e.message}` };
    }
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return {
      mcp,
      count: tools.length,
      tools: detail === "full" ? tools : tools.map(briefTool),
    };
  },
};
