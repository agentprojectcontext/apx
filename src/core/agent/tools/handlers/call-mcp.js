import { resolveProject } from "../helpers.js";
import { mcpToolRisk } from "#core/mcp/tool-risk.js";

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
  makeHandler: ({ projects, registries, requirePermission }) => async ({ project, mcp, tool, args = {}, confirmed = false }) => {
    const p = resolveProject(projects, project);
    if (!registries) throw new Error("MCP registry unavailable");
    const registry = registries.for ? registries.for(p) : registries.ensure(p);

    // Graded by the tool it is ABOUT to call, not wholesale.
    //
    // `call_mcp` used to be `dangerous: true` for everything, which is two
    // mistakes at once: under `total` it gates nothing at all, so an agent
    // whose whole tool list is read-only could still reach
    // `appsi_send_campaign`; and under `automatico` it gates EVERYTHING, so
    // every read asks too — and a routine, which has nobody to ask, simply
    // loses the sources it needed. See core/mcp/tool-risk.js.
    let descriptor = null;
    try {
      // The server's own `annotations.readOnlyHint` beats any guess from the
      // name. Best-effort: a listing that fails must not stop the call, it
      // only means we fall back to the name.
      const tools = await registry.listTools(mcp);
      descriptor = (Array.isArray(tools) ? tools : tools?.tools || []).find((t) => t?.name === tool) || null;
    } catch {
      // Unreachable or slow server — the heuristic still applies, and the call
      // below will fail on its own terms with a better message than ours.
    }

    const risk = mcpToolRisk(tool, descriptor);
    await requirePermission("call_mcp", {
      dangerous: risk.dangerous,
      confirmed,
      args: { mcp, tool, why: risk.reason },
    });

    return registry.call(mcp, tool, args);
  },
};
