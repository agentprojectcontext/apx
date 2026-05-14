import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs";
import { getHttp } from "../http.js";
import { println, error, success, dim } from "../ui.js";
import { spawn } from "node:child_process";

// ---------- status ----------

const statusCmd: CommandModule = {
  command: "status",
  describe: "Show daemon status",
  handler: async () => {
    try {
      const http = await getHttp();
      const health = (await http.get("/health")) as {
        status: string; version?: string; uptime_s?: number;
      };
      success(`Daemon running  version=${health.version ?? "?"}  uptime=${health.uptime_s ?? "?"}s`);
    } catch {
      error("Daemon is not running.");
      process.exit(1);
    }
  },
};

// ---------- start ----------

const startCmd: CommandModule = {
  command: "start",
  describe: "Start the APX daemon in the background",
  handler: async () => {
    try {
      const http = await getHttp();
      await http.get("/health");
      println(dim("Daemon is already running."));
    } catch {
      const daemon = spawn("apx-daemon", [], {
        detached: true,
        stdio: "ignore",
      });
      daemon.unref();
      success("Daemon started.");
    }
  },
};

// ---------- stop ----------

const stopCmd: CommandModule = {
  command: "stop",
  describe: "Gracefully stop the APX daemon",
  handler: async () => {
    try {
      const http = await getHttp();
      await http.post("/admin/shutdown", {});
      success("Daemon stopped.");
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- logs ----------

const logsCmd: CommandModule = {
  command: "logs",
  describe: "Stream daemon logs",
  builder: (yargs: Argv) =>
    yargs.option("tail", {
      alias: "n",
      type: "number",
      default: 50,
      describe: "Number of lines to show",
    }),
  handler: async (args: ArgumentsCamelCase<Record<string, unknown>>) => {
    try {
      const tail = (args.tail as number) ?? 50;
      const { homedir } = await import("node:os");
      const { createReadStream } = await import("node:fs");
      const { createInterface } = await import("node:readline");
      const logPath = `${homedir()}/.apx/daemon.log`;
      try {
        const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });
        const lines: string[] = [];
        for await (const line of rl) lines.push(line);
        const tailLines = lines.slice(-tail);
        tailLines.forEach((l) => println(l));
      } catch {
        error(`Log file not found: ${logPath}`);
        process.exit(1);
      }
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};

// ---------- parent ----------

export const daemonCmd: CommandModule = {
  command: "daemon",
  describe: "Manage the APX background daemon",
  builder: (yargs: Argv) =>
    yargs
      .command(statusCmd)
      .command(startCmd)
      .command(stopCmd)
      .command(logsCmd)
      .demandCommand(1, "Specify a daemon subcommand"),
  handler: () => {},
};
