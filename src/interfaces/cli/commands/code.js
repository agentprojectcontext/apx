// `apx code` — launch the APX terminal coding assistant (Solid.js TUI).
// The TUI runs its TypeScript source directly under bun; there is no
// legacy readline fallback anymore (removed with the old sys.js chat).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveProjectId } from "./project.js";
import { readConfig } from "#core/config/index.js";
import { readIdentity } from "#core/identity/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TUI_SRC = resolve(__dirname, "../../tui/run.ts");

export async function cmdCode(args) {
  const pid = await resolveProjectId(args?.flags?.project);
  const cfg = readConfig();
  const id = readIdentity();

  // Optional --agent <slug>: route chat to a project agent instead of the APX
  // default. Empty / missing flag means default ("super-agent" mode).
  const agentFlag = typeof args?.flags?.agent === "string" ? args.flags.agent.trim() : "";
  const routedAgentSlug = agentFlag || null;
  const defaultAgentLabel = id?.agent_name || cfg.super_agent?.name || "APX";

  if (!existsSync(TUI_SRC)) {
    throw new Error(
      "apx code: TUI source not found at src/interfaces/tui/run.ts — reinstall with `npm i -g @agentprojectcontext/apx`."
    );
  }

  // bun must resolve node_modules/tsconfig from the apx package root, so the
  // spawn cwd stays there — but we pass the user's actual working directory
  // (where they ran `apx code`) via --cwd so the TUI shows the real project
  // path + git branch instead of apx/src.
  const bunBin = process.env.BUN_PATH || "bun";
  const userCwd = process.cwd();
  const result = spawnSync(bunBin, [
    "--preload", "@opentui/solid/preload",
    TUI_SRC,
    "--pid", pid,
    "--agent", routedAgentSlug || defaultAgentLabel,
    "--model", cfg.super_agent?.model || "claude-3-5-sonnet",
    "--cwd", userCwd,
  ], { stdio: "inherit", cwd: resolve(__dirname, "../../..") });

  if (result.error?.code === "ENOENT") {
    throw new Error(
      "apx code: bun is required to run the TUI but was not found. Install it (https://bun.sh) or set BUN_PATH to the binary."
    );
  }
  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    process.exitCode = result.status;
  }
}
