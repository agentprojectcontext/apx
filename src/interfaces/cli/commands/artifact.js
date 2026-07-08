import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import open from "open";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

// Emit an OSC 8 terminal hyperlink when stdout is a TTY that likely supports
// it (iTerm2, modern VS Code, kitty, WezTerm, …). Falls back to the raw URL
// elsewhere so the link is always at least copy-pasteable.
function hyperlink(url, label = url) {
  if (process.stdout.isTTY) {
    return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
  }
  return label === url ? url : `${label} (${url})`;
}

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

// `apx artifact preview <name> [--open] [--share] [--no-watch]`
//
// Asks the daemon to spin up an ephemeral local web server that renders the
// artifact (HTML / React / static) and prints an interactive localhost link.
// The page auto-reloads when the artifact file changes (unless --no-watch).
// With --open the link is opened in the default browser; with --share a public
// tunnel URL is created too.
export async function cmdArtifactPreview(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact preview: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const watch = args.flags["no-watch"] ? false : true;

  let view;
  try {
    view = await http.post(
      `/projects/${pid}/artifacts/${encodeURIComponent(name)}/preview`,
      { watch }
    );
  } catch (e) {
    throw new Error(`could not preview "${name}": ${e.message}`);
  }

  console.log(`preview ready — ${view.kind} artifact "${view.name}"`);
  console.log(`  local:  ${hyperlink(view.url)}`);
  if (view.watch) console.log("  (auto-reloads on change — edit the artifact and the tab refreshes)");
  console.log(`  stop:   apx artifact stop ${view.id}`);

  if (args.flags.share) {
    await sharePreview(view.id, { open: !!args.flags.open });
  } else if (args.flags.open) {
    await open(view.url);
    console.log("  opened in your browser.");
  } else {
    console.log(`  open:   apx artifact preview ${name} --open`);
  }
}

// Shared helper: open a tunnel for an existing preview id and print the URL.
async function sharePreview(previewId, { open: doOpen = false } = {}) {
  let tunnel;
  try {
    tunnel = await http.post(`/previews/${previewId}/tunnel`, {});
  } catch (e) {
    throw new Error(`could not create tunnel: ${e.message}`);
  }
  console.log(`  public: ${hyperlink(tunnel.url)}  (${tunnel.provider})`);
  console.log("  ⚠ anyone with this URL can reach the preview while it's open.");
  if (doOpen) {
    await open(tunnel.url);
    console.log("  opened public URL in your browser.");
  }
}

// `apx artifact share <name> [--open] [--no-watch]`
// Convenience: preview + tunnel in one shot.
export async function cmdArtifactShare(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact share: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const watch = args.flags["no-watch"] ? false : true;

  const view = await http.post(
    `/projects/${pid}/artifacts/${encodeURIComponent(name)}/preview`,
    { watch }
  );
  console.log(`sharing ${view.kind} artifact "${view.name}"`);
  console.log(`  local:  ${hyperlink(view.url)}`);
  await sharePreview(view.id, { open: !!args.flags.open });
  console.log(`  stop:   apx artifact stop ${view.id}`);
}

// `apx artifact previews` — list running preview servers.
export async function cmdArtifactPreviews(args = {}) {
  const rows = await http.get(`/previews`);
  if (!rows.length) {
    console.log("(no running previews)");
    return;
  }
  console.log("ID".padEnd(10) + "NAME".padEnd(24) + "KIND".padEnd(8) + "URL");
  for (const r of rows) {
    console.log(
      r.id.padEnd(10) +
      String(r.name).slice(0, 22).padEnd(24) +
      String(r.kind).padEnd(8) +
      r.url + (r.tunnel ? `  → ${r.tunnel.url}` : "")
    );
  }
}

// `apx artifact stop <id> | --all` — stop preview server(s).
export async function cmdArtifactStop(args) {
  if (args.flags.all) {
    const rows = await http.get(`/previews`);
    for (const r of rows) await http.delete(`/previews/${r.id}`);
    console.log(`stopped ${rows.length} preview(s)`);
    return;
  }
  const id = args._[0];
  if (!id) throw new Error("apx artifact stop: missing <id> (or --all)");
  await http.delete(`/previews/${encodeURIComponent(id)}`);
  console.log(`stopped preview ${id}`);
}
