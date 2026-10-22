// MCP servers: listing, the owner's approval of a project's server, and the owner's own servers.

import { ErrorCode } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, notFound } from "../errors.ts";
import { ARGS_SECRET } from "../mcp/config.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handlers } from "./router.ts";

/** `switchable`: names besides the global servers the owner turns on or off per project (a connected integration). */
export function mcpHandlers(mcp: Mcp, store: Store, switchable: (name: string) => boolean = () => false) {
  return {
    "tools.approvals": ({ thread }) => ({ approvals: store.approvals.list(thread) }),
    "tools.revoke": ({ key, thread, agent }) => {
      store.approvals.revoke(key, thread, agent);
      return { ok: true };
    },
    "tools.grant_set": ({ key, agent, condition, expires_at }) => {
      const approval = store.approvals.update(key, agent, { condition, expires_at });
      if (!approval) throw notFound(`grant ${key}`);
      return { approval };
    },
    "mcp.tools": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      try {
        const tools = await mcp.toolPermissions(d);
        return { tools: tools.map(({ name, key, permanent, approved }) => ({ name, key, permanent, approved })) };
      } catch (e) {
        // A server that does not start is an answer to "what are its tools", not a failed call.
        if (e instanceof CallError && e.shape.code === ErrorCode.Unavailable) return { tools: [], error: e.message };
        throw e;
      }
    },
    "mcp.describe": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      return { tools: await mcp.describe(d, project) };
    },
    "mcp.call": async ({ scope, server, project, tool, arguments: args }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      return mcp.call(d, tool, args, project);
    },
    "mcp.approveTool": async ({ scope, server, project, tool }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      const target = (await mcp.toolPermissions(d)).find((t) => t.name === tool);
      if (!target) throw notFound(`MCP tool ${tool}`);
      store.approvals.grant(target, "always", "");
      return { ok: true };
    },
    "mcp.logs": ({ scope, server, project, lines }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      return { lines: mcp.logs(d, lines) };
    },
    "mcp.list": ({ project }) => ({ servers: mcp.status(project) }),
    "mcp.trust": ({ project, server, trusted }) => {
      const d = mcp.find(project ? "project" : "global", server, project);
      if (!d) throw badRequest(`no server ${server} in that project's .apc/mcps.json`);
      mcp.config.setTrust(d, trusted);
      if (!trusted) mcp.drop(d);
      const s = mcp.status(project).find((x) => x.scope === (project ? "project" : "global") && x.name === server);
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.toggle": ({ project, server, on }) => {
      if (!store.projects.get(project)) throw notFound(`project ${project}`);
      if (!mcp.find("global", server) && !switchable(server)) throw badRequest(`no global server ${server}`);
      mcp.config.setOn(project, server, on);
      return { servers: mcp.status(project) };
    },
    "mcp.signIn": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      await mcp.signIn(d);
      const s = mcp.status(project ?? d.only).find((x) => x.scope === scope && x.name === server);
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.test": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw badRequest(`no ${scope} server ${server}`);
      return mcp.test(d);
    },
    "mcp.set": ({ name, server, project }) => {
      if (Array.isArray(server?.args) && JSON.stringify(server.args).includes("secret://"))
        throw badRequest(ARGS_SECRET);
      if (!project) {
        mcp.config.setGlobal(name, server);
        mcp.drop({ scope: "global", name });
        return { servers: mcp.status() };
      }
      if (!store.projects.get(project)?.path) throw notFound(`project ${project}`);
      // A repo's file never holds the owner's secrets: whoever can read the repo would get them.
      if (server && JSON.stringify(server).includes("secret://"))
        throw badRequest("a project's .apc/mcps.json cannot use your variables (secret://); use a server of your own");
      const old = mcp.find("project", name, project);
      if (old) mcp.drop(old);
      mcp.config.setProject(project, name, server);
      // The owner wrote this definition: it is approved as written.
      const next = mcp.find("project", name, project);
      if (next) mcp.config.setTrust(next, true);
      return { servers: mcp.status(project) };
    },
  } satisfies Partial<Handlers>;
}
