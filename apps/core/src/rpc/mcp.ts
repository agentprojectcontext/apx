// MCP servers: listing, the owner's approval of a project's server, and the owner's own servers.

import { ErrorCode } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, conflict, notFound } from "../errors.ts";
import { checkConnectionGeneration } from "../extensions/connection-generation.ts";
import { mcpServerApproval } from "../mcp/approval.ts";
import { ARGS_SECRET } from "../mcp/config.ts";
import { assertManualName } from "../mcp/extension-names.ts";
import type { Mcp } from "../mcp/manager.ts";
import { finishSignIn, returnAddress } from "../mcp/sign-in.ts";
import type { Handlers } from "./router.ts";

/** `switchable`: names besides the global servers the owner turns on or off per project (a connected integration). */
export function mcpHandlers(mcp: Mcp, store: Store, switchable: (name: string) => boolean = () => false) {
  const permissionTarget = (
    scope: "global" | "project",
    name: string,
    project: string | undefined,
    expected: string | null | undefined,
    credentialKey: string | undefined,
    write = false,
  ) => {
    if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
    const d = mcp.find(scope, name, project);
    if (!d) throw notFound(`MCP server ${name}`);
    if (
      (expected !== undefined && (d.values_of ?? null) !== expected) ||
      (credentialKey !== undefined && d.credential_key !== credentialKey)
    )
      throw conflict("MCP credentials changed. Check the selected server before changing tool permissions.");
    if (write && expected === undefined && scope === "global" && project && !d.values_of)
      throw badRequest(
        "This project uses the shared server credentials. Omit project to change its shared permissions.",
      );
    return d;
  };
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
    "mcp.tools": async ({ scope, server, project, values_of, credential_key }) => {
      const d = permissionTarget(scope, server, project, values_of, credential_key);
      try {
        const tools = await mcp.toolPermissions(d);
        const mode = mcp.toolMode(d);
        const ownersOnly =
          mode === "all" && store.approvals.allows(mcpServerApproval(d), undefined, undefined, undefined, true);
        return {
          tools: tools.map(({ name, key, permanent, approved }) => ({ name, key, permanent, approved })),
          mode,
          ...(mode === "all" && !ownersOnly ? { by_default: true } : {}),
        };
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
    "mcp.approveTool": async ({ scope, server, project, tool, values_of, credential_key }) => {
      const d = permissionTarget(scope, server, project, values_of, credential_key, true);
      const target = (await mcp.toolPermissions(d)).find((t) => t.name === tool);
      if (!target) throw notFound(`MCP tool ${tool}`);
      store.approvals.grant(target, "always", "");
      return { ok: true };
    },
    "mcp.toolMode": async ({ scope, server, project, mode, ask, values_of, credential_key }) => {
      const d = permissionTarget(scope, server, project, values_of, credential_key, true);
      if (!d.enabled || !mcp.config.trusted(d)) throw badRequest("approve and enable this server first");
      if (ask?.length) {
        if (mode !== "all")
          throw badRequest("ask lists the tools that ask first while the rest are allowed: use mode all");
        const tools = await mcp.toolPermissions(d);
        const unknown = ask.filter((n) => !tools.some((t) => t.name === n));
        if (unknown.length)
          throw badRequest(
            `${server} has no tool ${unknown.join(", ")}; its tools: ${tools.map((t) => t.name).join(", ")}`,
          );
        // Checked before anything changes; then the owner-wide grants are replaced in one go.
        mcp.setToolMode(d, "ask");
        for (const t of tools) if (!ask.includes(t.name)) store.approvals.grant(t, "always", "");
      } else mcp.setToolMode(d, mode);
      const s = mcp
        .status(project ?? d.only)
        .find(
          (x) =>
            x.scope === scope &&
            x.name === server &&
            x.values_of === d.values_of &&
            x.credential_key === d.credential_key &&
            (scope !== "project" || x.project_id === d.project_id),
        );
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.logs": ({ scope, server, project, lines }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      return { lines: mcp.logs(d, lines) };
    },
    "mcp.list": ({ project }) => ({ servers: mcp.status(project) }),
    "mcp.trust": async ({ project, server, trusted }) => {
      const d = mcp.find(project ? "project" : "global", server, project);
      if (!d) throw badRequest(`no server ${server} in that project's .apx/mcps.json`);
      // Approved for the first time, or again after its file changed while it allowed all: every tool allowed.
      const was = mcp.allowsAll(d);
      const open = trusted && (mcp.config.trustUnset(d) || was);
      mcp.config.setTrust(d, trusted);
      if (!trusted) await mcp.drop(d);
      if (open) mcp.openNew(d, true, was ?? "default");
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
    "mcp.signIn": async ({ scope, server, project, connection_generation }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      if (d.extension_id) checkConnectionGeneration(store, d.extension_id, connection_generation);
      else if (connection_generation) throw conflict("This server does not belong to the selected extension");
      await mcp.signIn(d);
      const s = mcp.status(project ?? d.only).find((x) => x.scope === scope && x.name === server);
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.finishSignIn": async ({ scope, server, project, url }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw notFound(`MCP server ${server}`);
      const now = () => mcp.status(project ?? d.only).find((x) => x.scope === scope && x.name === server);
      const page = now()?.sign_in_url;
      if (!page) throw badRequest("this server is not waiting for a sign-in");
      const at = returnAddress(page, url);
      if (!at) throw badRequest("that is not the address this sign-in returns to");
      if (!(await finishSignIn(at))) throw badRequest("the server did not take this sign-in: start it again");
      const s = now();
      if (!s) throw new Error("server vanished");
      return { server: s };
    },
    "mcp.test": async ({ scope, server, project }) => {
      const d = mcp.find(scope, server, project);
      if (!d) throw badRequest(`no ${scope} server ${server}`);
      return mcp.test(d);
    },
    "mcp.set": async ({ name, server, project }) => {
      if (!project) assertManualName(store, name, !server);
      if (Array.isArray(server?.args) && JSON.stringify(server.args).includes("secret://"))
        throw badRequest(ARGS_SECRET);
      if (server?.project && !store.projects.get(server.project)) throw notFound(`project ${server.project}`);
      if (project && (server?.project !== undefined || server?.off_in !== undefined))
        throw badRequest("a repository server cannot set private availability");
      for (const p of server?.off_in ?? []) if (!store.projects.get(p)) throw notFound(`project ${p}`);
      if (!project) {
        const target = { scope: "global" as const, name };
        const release = mcp.suspend([target]);
        try {
          const before = mcp.config.global().find((d) => d.name === name);
          const was = before && mcp.allowsAll(before);
          await mcp.drop(target, true);
          const { off_in: offIn, ...definition } = server ?? {};
          mcp.config.setGlobal(name, server ? definition : null);
          // Where a global one is on is kept per project (mcp.toggle's switches): the dialog sets them all at once.
          if (offIn && server && !server.project) mcp.config.setOffIn(name, offIn);
          // A server that goes, or moves into one project, leaves no switches behind.
          if (!server || server.project) mcp.config.setOffIn(name, []);
          const after = mcp.config.global().find((d) => d.name === name && d.own);
          // Availability alone does not change a tool contract; credential-specific grants stay separately bound.
          if (!before || !after || before.hash !== after.hash) await mcp.drop(target);
          // New: every tool allowed (DECISIONS.md#d-279); the owner's edit keeps "allow all" if it had it.
          if (after && (!before || (was && before.hash !== after.hash))) mcp.openNew(after, true, was || "default");
          if (!after) mcp.forgetOpened(target);
          return { servers: mcp.status() };
        } finally {
          release();
        }
      }
      if (!store.projects.get(project)?.path) throw notFound(`project ${project}`);
      // A repo's file never holds the owner's secrets: whoever can read the repo would get them.
      if (server && JSON.stringify(server).includes("secret://"))
        throw badRequest("a project's .apx/mcps.json cannot use your variables (secret://); use a server of your own");
      const old = mcp.find("project", name, project);
      const was = old && mcp.allowsAll(old);
      if (old) await mcp.drop(old);
      mcp.config.setProject(project, name, server);
      // The owner wrote this definition: it is approved as written, and a new one allows every tool.
      const next = mcp.find("project", name, project);
      if (next) mcp.config.setTrust(next, true);
      if (next && (!old || was)) mcp.openNew(next, true, was || "default");
      if (!next) mcp.forgetOpened({ scope: "project", project_id: project, name });
      return { servers: mcp.status(project) };
    },
  } satisfies Partial<Handlers>;
}
