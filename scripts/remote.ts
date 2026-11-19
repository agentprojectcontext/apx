#!/usr/bin/env node
// Runs preflight, verify or any command on a Linux machine of the owner's over ssh + Docker, so the laptop stays free
// (rules/TESTING.md#remote-runner). What runs is what is on disk here, uncommitted edits included.
//   pnpm remote preflight | verify      the plan, with the same live bar as locally; Ctrl-C leaves it running
//   pnpm remote run -- pnpm perf        any command in the same box
//   pnpm remote status | attach | stop | screen [branch]
//   pnpm remote setup                   once per machine: folders, the repo runs are pushed to, the Docker image
// Host: APX_REMOTE_HOST or `git config apx.remoteHost` (an ssh alias, kept out of the repo). Folder there: APX_REMOTE_DIR (default apx-ci, under its home).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(import.meta.dirname);
const configured = (key: string) =>
  spawnSync("git", ["config", "--get", key], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "";
const host = process.env.APX_REMOTE_HOST || configured("apx.remoteHost");
const dir = process.env.APX_REMOTE_DIR ?? "apx-ci";
const cpus = process.env.APX_REMOTE_CPUS ?? "24";
const memory = process.env.APX_REMOTE_MEMORY ?? "40g";
const shards = process.env.APX_REMOTE_SHARDS ?? "4";

/** A branch name as a Docker- and folder-safe name: `feat/inbox-tabs` → `feat-inbox-tabs`. */
export function slotOf(branch: string): string {
  const s = branch
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 60);
  return s || "detached";
}

/** Single-quoted for a POSIX shell. */
export function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** The commit to run: HEAD, or a commit of the working tree on top of it when there are edits. Touches no ref or index. */
function snapshot(): { sha: string; dirty: boolean } {
  const head = git(["rev-parse", "HEAD"]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-remote-"));
  try {
    const index = path.join(tmp, "index");
    fs.copyFileSync(path.resolve(root, git(["rev-parse", "--git-path", "index"])), index);
    const env = { GIT_INDEX_FILE: index };
    git(["add", "-A"], env);
    const tree = git(["write-tree"], env);
    if (tree === git(["rev-parse", "HEAD^{tree}"])) return { sha: head, dirty: false };
    return { sha: git(["commit-tree", tree, "-p", head, "-m", "remote run: working tree"]), dirty: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function ssh(script: string, opts: { tty?: boolean; quiet?: boolean } = {}) {
  const args = [...(opts.tty ? ["-t"] : []), "-o", "ServerAliveInterval=30", host, script];
  return spawnSync("ssh", args, { stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
}

const box = (slot: string) => `apx-${slot}`;

function follow(slot: string): number {
  const name = box(slot);
  ssh(`docker logs -f ${name} 2>&1`, { tty: true });
  const r = ssh(`docker inspect -f '{{.State.Running}} {{.State.ExitCode}}' ${name}`, { quiet: true });
  const [running, code] = (r.stdout ?? "").trim().split(" ");
  if (running === "true") {
    process.stderr.write(`\nStill running on ${host}. Follow it again: pnpm remote attach ${slot}\n`);
    return 0;
  }
  return Number(code ?? 1);
}

function start(kind: "plan" | "run", args: string[]): number {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const slot = slotOf(branch);
  const { sha, dirty } = snapshot();
  process.stderr.write(`${host}: ${branch} at ${sha.slice(0, 9)}${dirty ? " (with uncommitted edits)" : ""}\n`);
  const push = spawnSync("git", ["push", "-q", "--force", `${host}:${dir}/apx.git`, `${sha}:refs/runs/${slot}`], {
    cwd: root,
    stdio: "inherit",
  });
  if (push.status !== 0) return push.status ?? 1;
  const name = box(slot);
  const work = `$HOME/${dir}/slots/${slot}`;
  const script = [
    "set -e",
    `if [ "$(docker inspect -f '{{.State.Running}}' ${name} 2>/dev/null)" = true ]; then echo "A run for ${branch} is already going: pnpm remote attach ${slot} or pnpm remote stop ${slot}" >&2; exit 3; fi`,
    `docker rm -f ${name} >/dev/null 2>&1 || true`,
    `[ -d ${work}/.git ] || git clone -q --no-checkout $HOME/${dir}/apx.git ${work}`,
    `cd ${work} && git fetch -q origin refs/runs/${slot} && git checkout -q --force FETCH_HEAD && git clean -qfdx -e node_modules`,
    `docker run -d -t --init --name ${name} --label apx-remote=${slot} --user "$(id -u):$(id -g)" --cpus ${cpus} --memory ${memory} -e APX_TEST_SHARDS=${shards}` +
      " --security-opt apparmor=apx-remote --security-opt seccomp=unconfined" +
      ` --shm-size 4g -p 127.0.0.1::6080 -v ${work}:/work -v $HOME/${dir}/cache:/cache apx-remote:latest` +
      ` ${kind} ${args.map(sh).join(" ")} >/dev/null`,
  ].join("\n");
  const r = ssh(script);
  if (r.status !== 0) return r.status ?? 1;
  process.stderr.write(`Screen: pnpm remote screen ${slot}   ·   Ctrl-C leaves it running\n`);
  return follow(slot);
}

function screen(slot: string): number {
  const r = ssh(`docker port ${box(slot)} 6080/tcp`, { quiet: true });
  const port = /:(\d+)\s*$/m.exec(r.stdout ?? "")?.[1];
  if (!port) {
    process.stderr.write(`No run for ${slot} on ${host}.\n`);
    return 1;
  }
  const local = process.env.APX_REMOTE_SCREEN_PORT ?? "6080";
  const url = `http://localhost:${local}/vnc.html?autoconnect=1&resize=scale&view_only=1`;
  process.stderr.write(`Screen of ${slot}: ${url}   (Ctrl-C closes it)\n`);
  if (process.platform === "darwin")
    spawn("sh", ["-c", `sleep 1.5; open ${sh(url)}`], { detached: true, stdio: "ignore" }).unref();
  return spawnSync("ssh", ["-N", "-L", `${local}:127.0.0.1:${port}`, host], { stdio: "inherit" }).status ?? 0;
}

/** Once per machine, and after the box's files change: the folders, the repo runs are pushed to, and the image. */
function setup(): number {
  const prep = ssh(
    `mkdir -p ${dir}/image ${dir}/cache ${dir}/slots && { [ -d ${dir}/apx.git ] || git init -q --bare ${dir}/apx.git; }`,
  );
  if (prep.status !== 0) return prep.status ?? 1;
  const files = ["Dockerfile", "entry.sh", "apparmor"].map((f) => path.join(root, "scripts", "remote", f));
  const copy = spawnSync("scp", ["-q", ...files, `${host}:${dir}/image/`], { stdio: "inherit" });
  if (copy.status !== 0) return copy.status ?? 1;
  // Chromium's sandbox needs user namespaces, which Ubuntu 24.04 denies to unconfined processes (asks for sudo).
  const profile = `sudo install -m 644 ${dir}/image/apparmor /etc/apparmor.d/apx-remote && sudo apparmor_parser -r /etc/apparmor.d/apx-remote`;
  return ssh(`${profile} && cd ${dir}/image && docker build -t apx-remote:latest .`, { tty: true }).status ?? 0;
}

function main(argv: string[]): number {
  if (!host) {
    process.stderr.write(
      "Set APX_REMOTE_HOST (or git config apx.remoteHost) to the ssh host that runs the box (rules/TESTING.md#remote-runner).\n",
    );
    return 2;
  }
  const [cmd = "preflight", ...rest] = argv;
  const dash = rest.indexOf("--");
  const slot = slotOf(rest[0] ?? git(["rev-parse", "--abbrev-ref", "HEAD"]));
  switch (cmd) {
    case "setup":
      return setup();
    case "run":
      return start("run", dash < 0 ? rest : rest.slice(dash + 1));
    case "status":
      return (
        ssh(
          `docker ps -a --filter label=apx-remote --format '{{.Label "apx-remote"}}\t{{.Status}}' ; ` +
            `for c in $(docker ps -q --filter label=apx-remote); do printf '%s  ' "$(docker inspect -f '{{index .Config.Labels "apx-remote"}}' $c)"; docker logs --tail 1 $c 2>&1 | tr '\\r' '\\n' | sed 's/\\x1b\\[[0-9;]*[A-Za-z]//g' | grep -v '^\\s*$' | tail -1; done`,
        ).status ?? 0
      );
    case "attach":
      return follow(slot);
    case "stop":
      return ssh(`docker stop -t 5 ${box(slot)} >/dev/null && echo stopped ${slot}`).status ?? 0;
    case "screen":
      return screen(slot);
    default:
      return start("plan", [cmd, ...rest]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
