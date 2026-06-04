import { confirmedProperty, resolveProject } from "../helpers.js";

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
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact MCP call"),
        },
        required: ["mcp", "tool"],
      },
    },
  },
  makeHandler: ({ projects, registries, requirePermission }) => async ({ project, mcp, tool, args = {}, confirmed = false }) => {
    requirePermission("call_mcp", { dangerous: true, confirmed });
    const p = resolveProject(projects, project);
    if (!registries) throw new Error("MCP registry unavailable");
    const registry = registries.for ? registries.for(p) : registries.ensure(p);
    return registry.call(mcp, tool, args);
  },
};
