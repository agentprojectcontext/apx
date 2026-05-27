import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDaemon, http } from "../http.js";

const PID_PATH = path.join(os.homedir(), ".apx", "daemon.pid");
const LOG_PATH = path.join(os.homedir(), ".apx", "daemon.log");

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[97m",
  gray:   "\x1b[90m",
};

const fmt = {
  bold:   (s) => `${c.bold}${s}${c.reset}`,
  dim:    (s) => `${c.dim}${s}${c.reset}`,
  green:  (s) => `${c.green}${s}${c.reset}`,
  red:    (s) => `${c.red}${s}${c.reset}`,
  yellow: (s) => `${c.yellow}${s}${c.reset}`,
  cyan:   (s) => `${c.cyan}${s}${c.reset}`,
  gray:   (s) => `${c.gray}${s}${c.reset}`,
  kv:     (k, v) => `  ${c.gray}${k.padEnd(10)}${c.reset}  ${v}`,
};

function uptime(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function debugRaw(label, data) {
  console.log(fmt.gray(`\n── debug: ${label} ──`));
  console.log(fmt.gray(JSON.stringify(data, null, 2)));
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function cmdDaemonStart(args = {}) {
  const debug = args.flags?.debug;
  await ensureDaemon();
  const status = await http.get("/health");
  if (debug) debugRaw("/health", status);
  console.log(
    `\n  ${fmt.green("●")} ${fmt.bold("apx daemon")} ${fmt.dim("v" + status.version)}` +
    `  ${fmt.gray("·")}  ${fmt.cyan("port")} ${status.port ?? (process.env.APX_PORT || 7430)}` +
    `  ${fmt.gray("·")}  ${fmt.cyan("uptime")} ${uptime(status.uptime_s)}\n`
  );
}

export async function cmdDaemonStatus(args = {}) {
  const debug = args.flags?.debug;
  const port = process.env.APX_PORT || 7430;

  if (!(await http.ping())) {
    console.log(
      `\n  ${fmt.red("○")} ${fmt.bold("apx daemon")}  ${fmt.dim("stopped")}` +
      `  ${fmt.gray("(no process on port " + port + ")")}\n`
    );
    process.exit(1);
  }

  const h        = await http.get("/health",   { autoStart: false });
  const projects = await http.get("/projects", { autoStart: false });
  const pid      = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH, "utf8").trim() : "?";

  if (debug) {
    debugRaw("/health",   h);
    debugRaw("/projects", projects);
  }

  console.log(
    `\n  ${fmt.green("●")} ${fmt.bold("apx daemon")} ${fmt.dim("v" + h.version)}  ${fmt.green("running")}`
  );
  console.log(fmt.kv("pid",     fmt.cyan(pid)));
  console.log(fmt.kv("port",    fmt.cyan(port)));
  console.log(fmt.kv("uptime",  fmt.cyan(uptime(h.uptime_s))));

  if (projects.length === 0) {
    console.log(fmt.kv("projects", fmt.dim("none registered")));
  } else {
    console.log(fmt.kv("projects", ""));
    for (const p of projects) {
      const agents = `${p.agents} agent${p.agents !== 1 ? "s" : ""}`;
      console.log(
        `    ${fmt.cyan("·")} ${fmt.bold(p.path)}  ${fmt.gray(agents)}`
      );
    }
  }
  console.log();
}

export async function cmdDaemonReload(args = {}) {
  const debug = args.flags?.debug;
  if (!(await http.ping())) {
    console.log(`\n  ${fmt.yellow("○")} ${fmt.bold("apx daemon")}  ${fmt.dim("not running — start first")}\n`);
    process.exit(1);
  }
  const res = await http.post("/admin/reload", undefined, { autoStart: false });
  if (debug) debugRaw("/admin/reload", res);
  console.log(`\n  ${fmt.green("↻")} ${fmt.bold("config reloaded")}`);
  if (res.super_agent_model) console.log(fmt.kv("model", fmt.cyan(res.super_agent_model)));
  if (res.fallback_order?.length) console.log(fmt.kv("fallback", fmt.cyan(res.fallback_order.join(" → "))));
  console.log();
}

export async function cmdDaemonStop(args = {}) {
  const debug = args.flags?.debug;

  if (!(await http.ping())) {
    console.log(`\n  ${fmt.yellow("○")} ${fmt.bold("apx daemon")}  ${fmt.dim("not running")}\n`);
    return;
  }

  try {
    const res = await http.post("/admin/shutdown", undefined, { autoStart: false });
    if (debug) debugRaw("/admin/shutdown", res);
    console.log(`\n  ${fmt.red("○")} ${fmt.bold("apx daemon")}  ${fmt.dim("stopped")}\n`);
  } catch {
    if (fs.existsSync(PID_PATH)) {
      try {
        const pid = parseInt(fs.readFileSync(PID_PATH, "utf8"), 10);
        if (pid) {
          process.kill(pid);
          console.log(`\n  ${fmt.red("○")} ${fmt.bold("apx daemon")}  ${fmt.dim(`stopped (pid ${pid})`)}\n`);
          return;
        }
      } catch {}
    }
    console.log(`\n  ${fmt.yellow("○")} ${fmt.bold("apx daemon")}  ${fmt.dim("not running")}\n`);
  }
}

export async function cmdDaemonLogs(args) {
  const debug = args.flags?.debug;
  const follow = args.flags?.follow || args.flags?.f;

  if (!fs.existsSync(LOG_PATH)) {
    console.log(fmt.gray(`  (no log file at ${LOG_PATH})`));
    return;
  }

  const tail = args.flags?.tail ? parseInt(args.flags.tail, 10) : 50;
  const content = fs.readFileSync(LOG_PATH, "utf8");
  const lines = content.split("\n");
  const slice = lines.slice(-tail - 1).filter(Boolean);

  if (debug) console.log(fmt.gray(`  log: ${LOG_PATH}  (last ${tail} lines)\n`));

  const printLine = (line) => {
    const colored = line
      .replace(/^(\d{4}-\d\d-\d\dT[\d:.Z]+)/, (m) => fmt.gray(m))
      .replace(/\bERROR\b/g, fmt.red("ERROR"))
      .replace(/\bWARN\b/g, fmt.yellow("WARN"))
      .replace(/\bINFO\b/g, fmt.cyan("INFO"));
    console.log(colored);
  };

  for (const line of slice) {
    printLine(line);
  }

  if (follow) {
    let currentSize = fs.statSync(LOG_PATH).size;
    fs.watch(LOG_PATH, (event) => {
      if (event === "change") {
        const newSize = fs.statSync(LOG_PATH).size;
        if (newSize > currentSize) {
          const stream = fs.createReadStream(LOG_PATH, {
            start: currentSize,
            end: newSize - 1,
          });
          stream.on("data", (chunk) => {
            const lines = chunk.toString().split("\n").filter(Boolean);
            for (const l of lines) printLine(l);
          });
          currentSize = newSize;
        } else if (newSize < currentSize) {
          // File truncated or rotated
          currentSize = newSize;
        }
      }
    });
    // Keep process alive
    return new Promise(() => {});
  }
}
