// MCP servers: listing, the owner's approval of a project's server, and the owner's own servers.
import { ErrorCode } from "@apx/protocol";
import { CallError } from "../errors.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handler } from "./router.ts";

export function mcpHandlers(mcp: Mcp) {
  return {
    "mcp.list": (({ project }) => ({ servers: mcp.status(project) })) as Handler<"mcp.list">,
    "mcp.trust": (({ project, server, trusted }) => {
      const d = mcp.find("project", server, project);
      if (!d)
        throw new CallError({
          code: ErrorCode.BadRequest,
          message: `no server ${server} in that project's .apc/mcps.json`,
        });
      mcp.config.setTrust(d, trusted);
      const s = mcp.status(project).find((x) => x.scope === "project" && x.name === server);
      if (!s) throw new CallError({ code: ErrorCode.Internal, message: "server vanished" });
      return { server: s };
    }) as Handler<"mcp.trust">,
    "mcp.set": (({ name, server }) => {
      mcp.config.setGlobal(name, server);
      return { servers: mcp.status() };
    }) as Handler<"mcp.set">,
  };
}
