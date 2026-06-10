import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

// First two bytes of an executable script. Used as a hint when the file
// doesn't have the exec bit but clearly intends to run (shebang line).
const SHEBANG = "#!";

// Decide if an artifact is "runnable": exec bit on the file, OR the file
// starts with a shebang. If shebang-but-not-exec, we set the bit before
// spawning so `./script` works without the user having to chmod +x.
function detectRunnable(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return { runnable: false, reason: "not_found" };
  }
  if (!stat.isFile()) return { runnable: false, reason: "not_a_file" };
  const execBit = (stat.mode & 0o111) !== 0;
  let hasShebang = false;
  try {
    const fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    hasShebang = buf.toString("utf8") === SHEBANG;
  } catch {
    // ignore: hasShebang stays false
  }
  if (execBit) return { runnable: true, reason: "exec_bit", autoChmod: false };
  if (hasShebang) return { runnable: true, reason: "shebang", autoChmod: true };
  return { runnable: false, reason: "no_exec_no_shebang" };
}

export async function cmdArtifactCreate(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact create: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const content = args.flags.content && args.flags.content !== true ? String(args.flags.content) : "";
  const r = await http.post(`/projects/${pid}/artifacts`, { name, content });
  console.log(r.path);
}

export async function cmdArtifactList(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const rows = await http.get(`/projects/${pid}/artifacts`);
  if (rows.length === 0) {
    console.log(`(no artifacts in project #${pid})`);
    return;
  }
  console.log(`project #${pid} artifacts:`);
  console.log("NAME".padEnd(30) + " SIZE   MODIFIED");
  for (const a of rows) {
    console.log(
      a.name.padEnd(30) + " " +
      String(a.size).padEnd(6) + " " +
      (a.modified || "—")
    );
  }
}

export async function cmdArtifactShow(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact show: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.get(`/projects/${pid}/artifacts/${encodeURIComponent(name)}`);
  process.stdout.write(r.content);
}

export async function cmdArtifactRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact remove: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/artifacts/${encodeURIComponent(name)}`);
  console.log(`removed artifact "${name}"`);
}

// `apx artifact run <name> [-- args...]`
//
// Resolves the artifact's absolute path via the daemon (single source of
// truth for project storage), then spawns the file LOCALLY with stdio
// inherited so the caller sees output as if they typed `./artifact <args>`.
// Detection is lenient: exec bit OR shebang → runnable; shebang-only files
// get a one-shot chmod +x so the user doesn't have to do it themselves.
//
// The remaining argv after `run <name>` is passed straight to the script,
// so `apx artifact run hello.sh -- hola mundo` becomes `./hello.sh hola mundo`.
export async function cmdArtifactRun(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact run: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  // Pull the artifact record from the daemon for the absolute path.
  let entry;
  try {
    entry = await http.get(`/projects/${pid}/artifacts/${encodeURIComponent(name)}`);
  } catch (e) {
    throw new Error(`artifact "${name}" not found in project #${pid}: ${e.message}`);
  }
  const absPath = entry.path;
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error(`artifact "${name}" path missing on disk: ${absPath}`);
  }

  const detection = detectRunnable(absPath);
  if (!detection.runnable) {
    const hint = detection.reason === "no_exec_no_shebang"
      ? "no es ejecutable (sin shebang ni bit +x). Probá `apx artifact show` para ver el contenido."
      : `no se puede ejecutar (${detection.reason}).`;
    throw new Error(`artifact "${name}" ${hint}`);
  }
  if (detection.autoChmod) {
    try {
      const st = fs.statSync(absPath);
      fs.chmodSync(absPath, st.mode | 0o111);
    } catch (e) {
      throw new Error(`could not chmod +x ${absPath}: ${e.message}`);
    }
  }

  // Everything after the artifact name is forwarded to the script. The CLI's
  // argv parser already strips top-level flags; what's left in `_` is name
  // + script args.
  const scriptArgs = (args._ || []).slice(1);
  const cwd = path.dirname(absPath);
  const child = spawn(absPath, scriptArgs, { stdio: "inherit", cwd });

  await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (signal) {
        // Killed by signal — surface a non-zero exit for shell pipelines.
        process.exit(128 + (signal === "SIGINT" ? 2 : 15));
      }
      process.exit(code ?? 0);
    });
    child.on("error", (err) => {
      console.error(`apx artifact run: spawn failed — ${err.message}`);
      resolve();
      process.exit(1);
    });
  });
}
