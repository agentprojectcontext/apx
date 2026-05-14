import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs";
import { getHttp } from "../http.js";
import { println, error, success, dim, bold, table, highlight } from "../ui.js";

interface Session {
  filename?: string;
  title?: string;
  started_at?: string;
  ended_at?: string;
  agent?: string;
  status?: string;
}

interface GlobalArgs {
  project?: string;
}

async function resolveProjectId(project?: string): Promise<string> {
  const http = await getHttp();
  const projects = (await http.get("/projects")) as Array<{
    id: string;
    name: string;
    path: string;
  }>;
  if (!projects?.length) throw new Error("No projects registered. Run: apx init");

  if (project) {
    const match = projects.find(
      (p) =>
        p.id === project ||
        p.name === project ||
        p.path === project ||
        p.path?.endsWith("/" + project),
    );
    if (!match) throw new Error(`Project not found: ${project}`);
    return match.id;
  }
  // Default to first project
  return projects[0]!.id;
}

// ---------- list ----------

const listCmd: CommandModule<GlobalArgs, GlobalArgs & { last: number; format: string }> = {
  command: "list",
  aliases: ["ls"],
  describe: "List sessions for the current project",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .option("last", {
        alias: "n",
        type: "number",
        default: 20,
        describe: "Number of recent sessions to show",
      })
      .option("format", {
        choices: ["table", "json"] as const,
        default: "table" as const,
        describe: "Output format",
      }),
  handler: async (args: ArgumentsCamelCase<GlobalArgs & { last: number; format: string }>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project);
      const sessions = (await http.get(`/projects/${pid}/sessions`)) as Session[];
      if (!sessions?.length) {
        println(dim("No sessions found."));
        return;
      }
      const slice = sessions.slice(-args.last);
      if (args.format === "json") {
        process.stdout.write(JSON.stringify(slice, null, 2) + "\n");
        return;
      }
      table(
        slice.map((s) => ({
          Title: s.title || s.filename || "(no title)",
          Agent: s.agent || "-",
          Started: s.started_at ? new Date(s.started_at).toLocaleString() : "-",
          Status: s.status || "open",
        })),
        ["Title", "Agent", "Started", "Status"],
      );
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- new ----------

const newCmd: CommandModule<GlobalArgs, GlobalArgs & { title?: string; body?: string; agent?: string }> = {
  command: "new",
  describe: "Create a new session",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .option("title", {
        type: "string",
        describe: "Session title",
      })
      .option("body", {
        type: "string",
        describe: "Initial session body / context",
      })
      .option("agent", {
        type: "string",
        describe: "Agent slug to associate the session with",
      }),
  handler: async (args: ArgumentsCamelCase<GlobalArgs & { title?: string; body?: string; agent?: string }>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project);
      const agentSlug = args.agent || "default";
      const session = (await http.post(`/projects/${pid}/agents/${agentSlug}/sessions`, {
        title: args.title || `Session ${new Date().toLocaleDateString()}`,
        body: args.body,
      })) as { filename: string; path: string };
      success(`Session created: ${highlight(session.filename)}`);
      if (session.path) println(dim(session.path));
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- get / show ----------

const getCmd: CommandModule<GlobalArgs, GlobalArgs & { id: string; body: boolean }> = {
  command: "get <id>",
  aliases: ["show"],
  describe: "Show a session by filename or ID",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .positional("id", { type: "string", demandOption: true, describe: "Session filename or ID" })
      .option("body", {
        type: "boolean",
        default: false,
        describe: "Print session body / markdown",
      }),
  handler: async (args: ArgumentsCamelCase<GlobalArgs & { id: string; body: boolean }>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project);
      const session = (await http.get(`/projects/${pid}/sessions/${args.id}`)) as Record<string, unknown>;
      if (args.body) {
        process.stdout.write(String(session.body_md || session.body || "") + "\n");
        return;
      }
      process.stdout.write(JSON.stringify(session, null, 2) + "\n");
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- delete ----------

const deleteCmd: CommandModule<GlobalArgs, GlobalArgs & { id: string }> = {
  command: "delete <id>",
  aliases: ["rm"],
  describe: "Delete a session",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs.positional("id", { type: "string", demandOption: true, describe: "Session filename or ID" }),
  handler: async (args: ArgumentsCamelCase<GlobalArgs & { id: string }>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project);
      await http.delete(`/projects/${pid}/sessions/${args.id}`);
      success(`Session deleted: ${args.id}`);
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- compact ----------

const compactCmd: CommandModule<GlobalArgs, GlobalArgs & { id?: string; model?: string }> = {
  command: "compact [id]",
  describe: "Summarize and compact a session's conversation history",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .positional("id", { type: "string", describe: "Session ID (defaults to latest)" })
      .option("model", { type: "string", describe: "Model to use for summarization" }),
  handler: async (args: ArgumentsCamelCase<GlobalArgs & { id?: string; model?: string }>) => {
    try {
      const http = await getHttp();
      const pid = await resolveProjectId(args.project);
      const path = args.id
        ? `/projects/${pid}/sessions/${args.id}/compact`
        : `/sessions/${pid}/compact`;
      const result = (await http.post(path, { model: args.model, project: pid })) as {
        compacted_turns?: number;
        summary?: string;
      };
      success(`Compacted ${result.compacted_turns ?? "?"} turns.`);
      if (result.summary) println(dim(result.summary));
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- parent command ----------

export const sessionCmd: CommandModule<GlobalArgs, GlobalArgs> = {
  command: "session",
  aliases: ["sessions"],
  describe: "Manage APC sessions",
  builder: (yargs: Argv<GlobalArgs>) =>
    yargs
      .command(listCmd as CommandModule)
      .command(newCmd as CommandModule)
      .command(getCmd as CommandModule)
      .command(deleteCmd as CommandModule)
      .command(compactCmd as CommandModule)
      .demandCommand(1, "Specify a session subcommand"),
  handler: () => {},
};
