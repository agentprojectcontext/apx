// Tools the super-agent can call directly (function calling). Two halves:
//   - SCHEMAS: the JSON-schema definitions sent to the model.
//   - HANDLERS: server-side implementations that operate on projects/messages.
//
// Every handler returns a JSON-serializable result; errors throw and the loop
// catches them so the tool message comes back as `{error: "..."}`.

import fs from "node:fs";
import path from "node:path";
import { callEngine } from "./engines/index.js";
import { getRuntime, RUNTIME_IDS } from "./runtimes/index.js";
import { readAgents } from "../core/parser.js";
import { readProjectMessages, searchProjectMessages } from "../core/messages-store.js";
import { readIdentity, writeIdentity } from "../core/identity.js";

// ---------- helpers ---------------------------------------------------------

function resolveProject(projects, target, { allowMulti = false } = {}) {
  if (target === undefined || target === null || target === "") {
    const all = projects.list();
    if (all.length === 1) return projects.get(all[0].id);
    if (allowMulti) return null; // signal "list all"
    throw new Error(
      `multiple projects registered (${all.length}); specify project=<id|name|path>`
    );
  }
  // numeric id
  if (typeof target === "number" || /^\d+$/.test(String(target))) {
    const e = projects.get(parseInt(target, 10));
    if (!e) throw new Error(`project id ${target} not found`);
    return e;
  }
  const tgt = String(target);
  const all = projects.list();
  // exact path or name
  const byPath = all.find((p) => p.path === path.resolve(tgt));
  if (byPath) return projects.get(byPath.id);
  const byName = all.find((p) => p.name === tgt);
  if (byName) return projects.get(byName.id);
  // substring on name or path
  const tgtLow = tgt.toLowerCase();
  const fuzzy = all.filter(
    (p) =>
      p.name.toLowerCase().includes(tgtLow) ||
      p.path.toLowerCase().includes(tgtLow)
  );
  if (fuzzy.length === 1) return projects.get(fuzzy[0].id);
  if (fuzzy.length > 1) {
    throw new Error(
      `project "${tgt}" is ambiguous; matches: ${fuzzy.map((p) => p.name).join(", ")}`
    );
  }
  throw new Error(`project "${tgt}" not found`);
}

function safePathJoin(root, sub) {
  // Refuse anything that escapes the project root.
  const target = path.resolve(root, sub || ".");
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`path "${sub}" escapes the project root`);
  }
  return target;
}

// ---------- SCHEMAS ---------------------------------------------------------

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "List all projects registered with the APX daemon. Returns id, name, path, agent count.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_agents",
      description: "List agents. If `project` is given, returns the agents of that project (slug, role, model, language, skills). If `project` is omitted AND there are multiple projects, returns ALL agents grouped by project — use this form when the user asks generically about 'los agentes' or 'lista de agentes' without specifying a project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, path, or substring. OMIT to list every project's agents." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_mcps",
      description: "List MCPs (multi-source merged: apf/cursor/claude/etc). If `project` is omitted AND there are multiple projects, returns ALL MCPs grouped by project.",
      parameters: {
        type: "object",
        properties: { project: { type: "string", description: "OMIT to list every project's MCPs." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_agent_memory",
      description: "Read an agent's memory.md file (its persistent long-term knowledge).",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "agent slug" },
        },
        required: ["agent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and subdirectories of a path inside the project root.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project; default '.'" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside the project root. Returns first 64KB.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tail_messages",
      description: "Tail the project's messages log. Optional filter by channel and/or agent slug.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          channel: { type: "string", description: "e.g. telegram, engine, a2a, runtime, heartbeat" },
          agent: { type: "string", description: "agent slug" },
          limit: { type: "integer", description: "max rows (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_messages",
      description: "Full-text search inside a project's messages.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_agent",
      description: "Run a one-shot prompt through a project agent's engine. Returns the agent's reply text.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "agent slug" },
          prompt: { type: "string" },
        },
        required: ["agent", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_mcp",
      description: "Call a tool on an MCP server registered in a project. Args is a JSON object.",
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
  {
    type: "function",
    function: {
      name: "call_runtime",
      description: "Spawn an external CLI agent (Claude Code, Codex, OpenCode, Aider) impersonating one of the project's APC agents. APX creates an APC session, builds the system prompt from the agent's memory+skills, runs the runtime, captures its transcript path. IMPORTANT: `agent` is the slug declared in AGENTS.md (e.g. 'sofia', 'martin', 'sandbox') — NOT the name of the LLM/runtime. The LLM/runtime goes in the `runtime` parameter ('claude-code', 'codex', 'opencode', 'aider'). If unsure which agents exist, call list_agents first.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          agent: { type: "string", description: "APC agent slug from AGENTS.md (sofia/martin/etc) — NOT the runtime name" },
          runtime: {
            type: "string",
            enum: ["claude-code", "codex", "opencode", "aider"],
            description: "which external CLI to spawn",
          },
          prompt: { type: "string" },
          timeout_s: { type: "integer", description: "seconds before SIGTERM (default 300)" },
        },
        required: ["agent", "runtime", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_telegram",
      description: "Send a Telegram message via the daemon's Telegram plugin. Optional channel and chat_id.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "telegram channel name; omit for default" },
          chat_id: { type: "string", description: "destination chat id; omit to use the channel default" },
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_identity",
      description: "Update the daemon's own identity fields (agent_name, owner_name, personality, language). Use when the user asks to rename the agent, change its personality, or update owner info. The change persists across restarts.",
      parameters: {
        type: "object",
        properties: {
          agent_name: { type: "string", description: "New name for the agent (e.g. 'Roby')" },
          owner_name: { type: "string", description: "Owner's name" },
          personality: { type: "string", description: "Comma-separated personality traits" },
          language: { type: "string", description: "Preferred language for agent messages (e.g. 'es', 'en', 'Spanish', 'Español')" },
        },
      },
    },
  },
];

// ---------- HANDLERS --------------------------------------------------------

export function makeToolHandlers({ projects, plugins, registries, globalConfig }) {
  return {
    list_projects: () => {
      return projects.list().map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        agents: p.agents,
      }));
    },

    list_agents: ({ project } = {}) => {
      const agentRow = (a) => ({
        slug: a.slug,
        role: a.fields.Role || null,
        model: a.fields.Model || null,
        language: a.fields.Language || null,
        description: a.fields.Description || null,
        skills: (a.fields.Skills || "").split(",").map((s) => s.trim()).filter(Boolean),
      });
      const p = resolveProject(projects, project, { allowMulti: true });
      if (p) {
        return readAgents(p.path).map(agentRow);
      }
      // No project specified and >1 registered → return everything grouped.
      return projects.list().map((entry) => {
        const e = projects.get(entry.id);
        return {
          project: { id: entry.id, name: entry.name, path: entry.path },
          agents: readAgents(e.path).map(agentRow),
        };
      });
    },

    list_mcps: ({ project } = {}) => {
      const mcpRow = (m) => ({
        name: m.name,
        source: m.source,
        transport: m.transport,
        enabled: !!m.enabled,
        command: m.command,
        url: m.url,
      });
      const p = resolveProject(projects, project, { allowMulti: true });
      if (p) {
        if (!registries) throw new Error("MCP registry unavailable");
        return registries.for(p).list().map(mcpRow);
      }
      return projects.list().map((entry) => {
        const e = projects.get(entry.id);
        return {
          project: { id: entry.id, name: entry.name, path: entry.path },
          mcps: registries ? registries.for(e).list().map(mcpRow) : [],
        };
      });
    },

    read_agent_memory: ({ project, agent }) => {
      const p = resolveProject(projects, project);
      const f = path.join(p.path, ".apc", "agents", agent, "memory.md");
      if (!fs.existsSync(f)) return { error: `no memory.md for agent ${agent}` };
      return { body: fs.readFileSync(f, "utf8") };
    },

    list_files: ({ project, path: sub = "." }) => {
      const p = resolveProject(projects, project);
      const target = safePathJoin(p.path, sub);
      if (!fs.existsSync(target)) return { error: `path not found: ${sub}` };
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) return { error: `${sub} is not a directory` };
      return fs.readdirSync(target).map((name) => {
        const full = path.join(target, name);
        const s = fs.statSync(full);
        return {
          name,
          type: s.isDirectory() ? "dir" : "file",
          size: s.size,
        };
      });
    },

    read_file: ({ project, path: sub }) => {
      if (!sub) throw new Error("read_file: path required");
      const p = resolveProject(projects, project);
      const target = safePathJoin(p.path, sub);
      if (!fs.existsSync(target)) return { error: `file not found: ${sub}` };
      const buf = fs.readFileSync(target, "utf8").slice(0, 64 * 1024);
      return { content: buf, truncated: fs.statSync(target).size > 64 * 1024 };
    },

    tail_messages: ({ project, channel, agent, limit = 20 }) => {
      const p = resolveProject(projects, project);
      return readProjectMessages(p.path, {
        channel,
        agent_slug: agent,
        limit: Math.min(limit, 100),
      }).map((m) => ({ ts: m.ts, channel: m.channel, direction: m.direction, author: m.author, body: m.body }));
    },

    search_messages: ({ project, query }) => {
      if (!query) throw new Error("search_messages: query required");
      const p = resolveProject(projects, project);
      return searchProjectMessages(p.path, query, 25)
        .map((m) => ({ ts: m.ts, channel: m.channel, direction: m.direction, author: m.author, body: m.body }));
    },

    call_agent: async ({ project, agent: slug, prompt }) => {
      const p = resolveProject(projects, project);
      const agent = readAgents(p.path).find((a) => a.slug === slug);
      if (!agent) throw new Error(`agent ${slug} not found`);
      const model = agent.fields.Model;
      if (!model) throw new Error(`agent ${slug} has no model`);
      const parts = [];
      if (agent.fields.Description) parts.push(agent.fields.Description);
      if (agent.fields.Role) parts.push(`Role: ${agent.fields.Role}`);
      const memPath = path.join(p.path, ".apc", "agents", slug, "memory.md");
      if (fs.existsSync(memPath)) parts.push("## Memory\n" + fs.readFileSync(memPath, "utf8"));
      const apxSkill = path.join(p.path, ".apc", "skills", "apx.md");
      if (fs.existsSync(apxSkill)) parts.push("## APX\n" + fs.readFileSync(apxSkill, "utf8"));
      const skills = (agent.fields.Skills || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const skill of skills) {
        const sp = path.join(p.path, ".apc", "skills", `${skill}.md`);
        if (fs.existsSync(sp)) parts.push(`## Skill: ${skill}\n` + fs.readFileSync(sp, "utf8"));
      }
      const result = await callEngine({
        modelId: model,
        system: parts.join("\n\n"),
        messages: [{ role: "user", content: prompt }],
        config: p.config || globalConfig,
      });
      p.logMessage({
        agent_slug: slug,
        channel: "engine",
        direction: "out",
        author: slug,
        body: result.text,
        meta: { invoked_by: "super_agent_tool", usage: result.usage },
      });
      return { text: result.text, usage: result.usage };
    },

    call_mcp: async ({ project, mcp, tool, args = {} }) => {
      const p = resolveProject(projects, project);
      if (!registries) throw new Error("MCP registry unavailable");
      const reg = registries.for ? registries.for(p) : registries.ensure(p);
      const result = await reg.call(mcp, tool, args);
      return result;
    },

    call_runtime: async ({ project, agent: slug, runtime, prompt, timeout_s = 300 }) => {
      // If `project` was not provided AND multiple projects exist, try to
      // find the agent across all of them. Only one match → use it. Zero or
      // multiple matches → return an actionable error instead of throwing.
      let p;
      if (project) {
        p = resolveProject(projects, project);
      } else {
        const all = projects.list();
        if (all.length === 1) {
          p = projects.get(all[0].id);
        } else {
          const matches = [];
          for (const entry of all) {
            const e = projects.get(entry.id);
            if (readAgents(e.path).find((a) => a.slug === slug)) matches.push(e);
          }
          if (matches.length === 1) {
            p = matches[0];
          } else if (matches.length > 1) {
            return {
              error: `agent "${slug}" exists in multiple projects: ${matches.map((m) => m.path).join(", ")}. Specify project explicitly.`,
              candidates: matches.map((m) => m.path),
            };
          } else {
            // Not found anywhere — give the model the global directory
            const directory = all.map((entry) => {
              const e = projects.get(entry.id);
              return { project: entry.name, path: entry.path, agents: readAgents(e.path).map((a) => a.slug) };
            });
            return {
              error: `agent "${slug}" not found in any registered project.`,
              directory,
            };
          }
        }
      }
      const agent = readAgents(p.path).find((a) => a.slug === slug);
      if (!agent) {
        const available = readAgents(p.path).map((a) => a.slug).sort();
        return {
          error: `agent "${slug}" not found in project "${p.path}". Available agents: ${available.join(", ")}. Note: 'agent' is the APC agent slug (e.g. sofia, martin); 'runtime' is the external CLI (claude-code, codex, opencode, aider).`,
          available_agents: available,
        };
      }
      let rt;
      try {
        rt = getRuntime(runtime);
      } catch (e) {
        return { error: `${e.message}. Available runtimes: ${RUNTIME_IDS.join(", ")}` };
      }
      const parts = [];
      if (agent.fields.Description) parts.push(agent.fields.Description);
      if (agent.fields.Role) parts.push(`Role: ${agent.fields.Role}`);
      const memPath = path.join(p.path, ".apc", "agents", slug, "memory.md");
      if (fs.existsSync(memPath)) parts.push("## Memory\n" + fs.readFileSync(memPath, "utf8"));
      const apxSkill = path.join(p.path, ".apc", "skills", "apx.md");
      if (fs.existsSync(apxSkill)) parts.push("## APX\n" + fs.readFileSync(apxSkill, "utf8"));
      const skills = (agent.fields.Skills || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const skill of skills) {
        const sp = path.join(p.path, ".apc", "skills", `${skill}.md`);
        if (fs.existsSync(sp)) parts.push(`## Skill: ${skill}\n` + fs.readFileSync(sp, "utf8"));
      }
      const r = await rt.run({
        system: parts.join("\n\n"),
        prompt,
        cwd: p.path,
        timeoutMs: timeout_s * 1000,
      });
      // Log on channel='runtime' so it shows up in messages tail
      p.logMessage({
        agent_slug: slug,
        channel: "runtime",
        direction: "in",
        author: "user",
        body: prompt,
        meta: { runtime, invoked_by: "super_agent_tool" },
      });
      p.logMessage({
        agent_slug: slug,
        channel: "runtime",
        direction: "out",
        author: slug,
        body: r.output || "",
        meta: {
          runtime,
          exit_code: r.exitCode,
          external_session_path: r.externalSessionPath || null,
          invoked_by: "super_agent_tool",
        },
      });
      return {
        runtime,
        exit_code: r.exitCode,
        output: (r.output || "").slice(0, 4000),
        truncated: (r.output || "").length > 4000,
        external_session_path: r.externalSessionPath || null,
      };
    },

    send_telegram: async ({ channel, chat_id, text }) => {
      if (!plugins) throw new Error("plugins unavailable");
      const tg = plugins.get("telegram");
      if (!tg) throw new Error("telegram plugin not loaded");
      const r = await tg.send({ channel, chat_id, text, author: "apx" });
      return { ok: true, message_id: r.message_id };
    },

    set_identity: ({ agent_name, owner_name, personality, language } = {}) => {
      const fields = {};
      if (agent_name) fields.agent_name = agent_name;
      if (owner_name) fields.owner_name = owner_name;
      if (personality) fields.personality = personality;
      if (language) fields.language = language;
      if (Object.keys(fields).length === 0) throw new Error("no fields provided");
      const updated = writeIdentity(fields);
      return { ok: true, identity: updated };
    },
  };
}
