// Who is running: version, code sha and a stable home id.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Identity = { version: string; code_sha: string; home_id: string; started_at: Date };

export function readIdentity(home: string, env: NodeJS.ProcessEnv = process.env): Identity {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8")) as { version: string };
  return {
    version: pkg.version,
    code_sha: env.APX_CODE_SHA ?? gitSha(),
    home_id: homeId(home),
    started_at: new Date(),
  };
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: APP_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function homeId(home: string): string {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "home-id");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const id = randomUUID();
  fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
  return id;
}
