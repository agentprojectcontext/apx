import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs";
import { getHttp } from "../http.js";
import { println, error, success, dim, highlight, table } from "../ui.js";

interface GlobalArgs { project?: string }

async function resolveProjectId(project?: string): Promise<string> {
  const http = await getHttp();
  const projects = (await http.get("/projects")) as Array<{ id: string; name: string; path: string }>;
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");
  if (project) {
    const match = projects.find(
      (p) => p.id === project || p.name === project || p.path === project || p.path?.endsWith("/" + project),
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  return projects[0]!.id;
}

// ---------- list ----------

const listCmd: CommandModule = {
  command: "list",
  aliases: ["ls"],
  describe: "List registered MCP servers",
  handler: async (args: ArgumentsCamelCase<GlobalArgs>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project as string | undefined);
      const mcps = (await http.get(`/projects/${pid}/mcps`)) as Array<{
        name: string; transport?: string; enabled?: boolean; source?: string;
      }>;
      if (!mcps?.length) { println(dim("No MCP servers configured.")); return; }
      table(
        mcps.map((m) => ({
          Name: m.name,
          Transport: m.transport || "-",
          Enabled: m.enabled ? "✓" : "✗",
          Source: m.source || "-",
        })),
        ["Name", "Transport", "Enabled", "Source"],
      );
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- add ----------

const addCmd: CommandModule = {
  command: "add <name>",
  describe: "Register an MCP server",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", demandOption: true, describe: "MCP server name" })
      .option("command", { alias: "c", type: "string", describe: "Command to launch MCP server" })
      .option("url", { type: "string", describe: "Remote MCP server URL (for HTTP transport)" })
      .option("env", {
        type: "array",
        string: true,
        describe: "Environment variables (KEY=VALUE)",
      })
      .option("enabled", { type: "boolean", default: true, describe: "Enable the server" }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const name = args.name as string;
      const command = args.command as string | undefined;
      const url = args.url as string | undefined;
      const env = args.env as string[] | undefined;
      const enabled = args.enabled as boolean;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      // Parse env KEY=VALUE pairs
      const envRecord: Record<string, string> = {};
      for (const e of env ?? []) {
        const idx = e.indexOf("=");
        if (idx > 0) envRecord[e.slice(0, idx)] = e.slice(idx + 1);
      }
      const body: Record<string, unknown> = {
        name,
        enabled,
      };
      if (command) body.command = command;
      if (url) body.url = url;
      if (Object.keys(envRecord).length) body.env = envRecord;

      await http.post(`/projects/${pid}/mcps`, body);
      success(`MCP server registered: ${highlight(name)}`);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- remove ----------

const removeCmd: CommandModule = {
  command: "remove <name>",
  aliases: ["rm"],
  describe: "Remove an MCP server",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true, describe: "MCP server name" }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const name = args.name as string;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      await http.delete(`/projects/${pid}/mcps/${name}`);
      success(`MCP server removed: ${name}`);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- enable / disable ----------

const enableCmd: CommandModule = {
  command: "enable <name>",
  describe: "Enable an MCP server",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const name = args.name as string;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      await http.post(`/projects/${pid}/mcps`, { name, enabled: true });
      success(`Enabled: ${name}`);
    } catch (err: unknown) { error(String(err)); process.exit(1); }
  },
};

const disableCmd: CommandModule = {
  command: "disable <name>",
  describe: "Disable an MCP server",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const name = args.name as string;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      await http.post(`/projects/${pid}/mcps`, { name, enabled: false });
      success(`Disabled: ${name}`);
    } catch (err: unknown) { error(String(err)); process.exit(1); }
  },
};

// ---------- tools ----------

const toolsCmd: CommandModule = {
  command: "tools <name>",
  describe: "List tools exposed by an MCP server",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const name = args.name as string;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      const result = (await http.post(`/mcp/run`, {
        project: pid,
        name,
        tool: "list_tools",
        params: {},
      })) as { result?: { tools?: Array<{ name: string; description?: string }> } };
      const tools = result?.result?.tools ?? [];
      if (!tools.length) { println(dim("No tools found.")); return; }
      table(
        tools.map((t) => ({ Tool: t.name, Description: t.description?.slice(0, 60) || "-" })),
        ["Tool", "Description"],
      );
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- check ----------

const checkCmd: CommandModule = {
  command: "check",
  describe: "Validate MCP configuration",
  handler: async (args: ArgumentsCamelCase<GlobalArgs>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project as string | undefined);
      const result = (await http.get(`/projects/${pid}/mcps/check`)) as {
        conflicts?: string[];
        entries?: Array<{ name: string; ok: boolean; error?: string }>;
      };
      if (result.conflicts?.length) {
        println("\x1b[93m⚠ Conflicts:\x1b[0m");
        result.conflicts.forEach((c) => println("  " + c));
      }
      result.entries?.forEach((e) => {
        if (e.ok) success(e.name);
        else error(`${e.name}: ${e.error}`);
      });
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- parent ----------

export const mcpCmd: CommandModule = {
  command: "mcp",
  describe: "Manage MCP (Model Context Protocol) servers",
  builder: (yargs: Argv) =>
    yargs
      .command(listCmd)
      .command(addCmd)
      .command(removeCmd)
      .command(enableCmd)
      .command(disableCmd)
      .command(toolsCmd)
      .command(checkCmd)
      .demandCommand(1, "Specify an mcp subcommand"),
  handler: () => {},
};
