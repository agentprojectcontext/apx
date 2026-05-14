import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { getHttp } from "../http.js";
import { println, error, success, dim, bold, highlight } from "../ui.js";

export const statusCmd: CommandModule = {
  command: "status",
  describe: "Show APX system health and project overview",
  handler: async (args: ArgumentsCamelCase<{ project?: string }>) => {
    try {
      const http = await getHttp();

      // Daemon health
      let daemonOk = false;
      try {
        const health = (await http.get("/health")) as { version?: string; uptime_s?: number };
        println(
          "\x1b[92m●\x1b[0m Daemon  " +
          dim(`v${health.version ?? "?"}`) +
          "  uptime " + dim(`${health.uptime_s ?? "?"}s`),
        );
        daemonOk = true;
      } catch {
        println("\x1b[91m✗\x1b[0m Daemon  " + dim("not running — run: apx daemon start"));
      }

      if (!daemonOk) { process.exit(1); return; }

      // Projects
      const projects = (await http.get("/projects")) as Array<{
        id: string; name: string; path: string;
      }>;
      println("");
      println(bold("Projects") + "  " + dim(`(${projects?.length ?? 0})`));
      if (!projects?.length) {
        println(dim("  No projects. Run: apx init <path>"));
      } else {
        for (const p of projects) {
          const isActive = !args.project || p.name === args.project || p.id === args.project;
          println(
            (isActive ? "\x1b[94m▶\x1b[0m" : " ") +
            " " + highlight(p.name ?? p.id) +
            "  " + dim(p.path),
          );
        }
      }

      // Engines
      try {
        const eng = (await http.get("/engines")) as { engines: string[] };
        if (eng?.engines?.length) {
          println("");
          println(bold("Engines") + "  " + dim(`(${eng.engines.length})`));
          println(dim("  " + eng.engines.slice(0, 6).join("  ") + (eng.engines.length > 6 ? "  …" : "")));
        }
      } catch { /* engines endpoint optional */ }
    } catch (err: unknown) {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
};
