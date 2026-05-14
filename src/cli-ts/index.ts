// APX CLI v2 — TypeScript entry point, yargs-based.
// This replaces the manual arg-parsing in src/cli/index.js for commands
// that have been migrated here. Unmigrated commands delegate to the legacy handler.

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { sessionCmd } from "./commands/session.js";
import { agentCmd } from "./commands/agent.js";
import { mcpCmd } from "./commands/mcp.js";
import { daemonCmd } from "./commands/daemon.js";
import { statusCmd } from "./commands/status.js";
import { execCmd } from "./commands/exec.js";
import { chatCmd } from "./commands/chat.js";

process.on("unhandledRejection", (err) => {
  process.stderr.write(
    "\x1b[91m✖ Unhandled error:\x1b[0m " + String(err) + "\n",
  );
  process.exit(1);
});

yargs(hideBin(process.argv))
  .scriptName("apx")
  .usage("$0 <command> [options]")
  .version(false) // we handle --version ourselves below
  .option("project", {
    alias: "p",
    type: "string",
    describe: "Project name, ID, or path",
    global: true,
  })
  .option("json", {
    type: "boolean",
    describe: "Output as JSON",
    global: false,
  })
  .command(sessionCmd)
  .command(agentCmd)
  .command(mcpCmd)
  .command(daemonCmd)
  .command(statusCmd)
  .command(execCmd)
  .command(chatCmd)
  .command({
    command: "version",
    aliases: ["--version", "-v"],
    describe: "Print APX version",
    handler: async () => {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      try {
        const pkg = req("../../package.json") as { version: string };
        process.stdout.write(pkg.version + "\n");
      } catch {
        process.stdout.write("unknown\n");
      }
    },
  })
  .demandCommand(1, "Specify a command. Use --help for available commands.")
  .strict()
  .wrap(Math.min(100, yargs().terminalWidth()))
  .help()
  .alias("help", "h")
  .fail((msg, err) => {
    if (err) throw err;
    process.stderr.write("\x1b[91m✖ " + msg + "\x1b[0m\n\n");
    process.exit(1);
  })
  .parseAsync()
  .catch((err: Error) => {
    process.stderr.write("\x1b[91m✖ " + err.message + "\x1b[0m\n");
    process.exit(1);
  });
