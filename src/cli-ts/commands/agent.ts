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
  describe: "List agents in the current project",
  handler: async (args: ArgumentsCamelCase<GlobalArgs>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project as string | undefined);
      const agents = (await http.get(`/projects/${pid}/agents`)) as Array<{
        slug: string; role?: string; model?: string; description?: string;
      }>;
      if (!agents?.length) { println(dim("No agents found.")); return; }
      table(
        agents.map((a) => ({
          Slug: a.slug,
          Role: a.role || "-",
          Model: a.model || "-",
          Description: a.description ? a.description.slice(0, 50) : "-",
        })),
        ["Slug", "Role", "Model", "Description"],
      );
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- get / show ----------

const getCmd: CommandModule = {
  command: "get <slug>",
  aliases: ["show"],
  describe: "Show agent details and memory",
  builder: (yargs: Argv) =>
    yargs.positional("slug", { type: "string", demandOption: true, describe: "Agent slug" }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const slug = args.slug as string;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      const agent = (await http.get(`/projects/${pid}/agents/${slug}`)) as Record<string, unknown>;
      process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- add / create ----------

const addCmd: CommandModule = {
  command: "add <slug>",
  aliases: ["create"],
  describe: "Create a new agent",
  builder: (yargs: Argv) =>
    yargs
      .positional("slug", { type: "string", demandOption: true, describe: "Agent slug (identifier)" })
      .option("role", { type: "string", describe: "Agent role (system prompt)" })
      .option("model", { type: "string", describe: "LLM model (e.g. claude-sonnet-4-6)" })
      .option("description", { alias: "d", type: "string", describe: "Short description" })
      .option("skills", { type: "string", describe: "Comma-separated skill list" })
      .option("language", { type: "string", describe: "Language code (e.g. en, es)" })
      .option("tools", { type: "string", describe: "Comma-separated allowed tools" }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const slug = args.slug as string;
      const role = args.role as string | undefined;
      const model = args.model as string | undefined;
      const description = args.description as string | undefined;
      const skills = args.skills as string | undefined;
      const language = args.language as string | undefined;
      const tools = args.tools as string | undefined;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      const agent = await http.post(`/projects/${pid}/agents`, {
        slug,
        role,
        model,
        description,
        skills: skills?.split(",").map((s) => s.trim()).filter(Boolean),
        language,
        tools: tools?.split(",").map((t) => t.trim()).filter(Boolean),
      });
      success(`Agent created: ${highlight(slug)}`);
      process.stdout.write(JSON.stringify(agent, null, 2) + "\n");
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- memory ----------

const memoryCmd: CommandModule = {
  command: "memory <slug>",
  describe: "Read or write agent memory",
  builder: (yargs: Argv) =>
    yargs
      .positional("slug", { type: "string", demandOption: true, describe: "Agent slug" })
      .option("append", { type: "boolean", default: false, describe: "Append stdin to memory" })
      .option("replace", { type: "boolean", default: false, describe: "Replace memory with stdin" }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const project = args.project as string | undefined;
      const slug = args.slug as string;
      const append = args.append as boolean;
      const replace = args.replace as boolean;
      const http = await getHttp();
      const pid = await resolveProjectId(project);
      if (append || replace) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString();
        if (append) {
          const existing = (await http.get(`/projects/${pid}/agents/${slug}/memory`)) as { body: string };
          await http.put(`/projects/${pid}/agents/${slug}/memory`, { body: (existing.body || "") + "\n" + body });
        } else {
          await http.put(`/projects/${pid}/agents/${slug}/memory`, { body });
        }
        success("Memory updated.");
      } else {
        const mem = (await http.get(`/projects/${pid}/agents/${slug}/memory`)) as { body: string };
        process.stdout.write(mem.body || "");
      }
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- parent ----------

export const agentCmd: CommandModule = {
  command: "agent",
  aliases: ["agents"],
  describe: "Manage APC agents",
  builder: (yargs: Argv) =>
    yargs
      .command(listCmd)
      .command(getCmd)
      .command(addCmd)
      .command(memoryCmd)
      .demandCommand(1, "Specify an agent subcommand"),
  handler: () => {},
};
