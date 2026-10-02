// MCP servers: listing, the owner's approval of a project's server, and the owner's own servers.
import { badRequest } from "../errors.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handlers } from "./router.ts";

export function mcpHandlers(mcp: Mcp) {
  return {
    "mcp.list": ({ project }) => ({ servers: mcp.status(project) }),
    "mcp.trust": ({ project, server, trusted }) => {
      const d = mcp.find("project", server, project);
      if (!d) throw badRequest(`no server ${server} in that project's .apc/mcps.json`);
      mcp.config.setTrust(d, trusted);
      if (!trusted) mcp.drop(d);
      const s = mcp.status(project).find((x) => x.scope === "project" && x.name === server);
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.toggle": ({ project, server, on }) => {
      if (!mcp.find("global", server)) throw badRequest(`no global server ${server}`);
      mcp.config.setOn(project, server, on);
      return { servers: mcp.status(project) };
    },
    "mcp.test": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw badRequest(`no ${scope} server ${server}`);
      return mcp.test(d);
    },
    "mcp.set": ({ name, server }) => {
      mcp.config.setGlobal(name, server);
      mcp.drop({ scope: "global", name });
      return { servers: mcp.status() };
    },
  } satisfies Partial<Handlers>;
}
