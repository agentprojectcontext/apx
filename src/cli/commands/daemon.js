import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDaemon, http } from "../http.js";

const PID_PATH = path.join(os.homedir(), ".apx", "daemon.pid");
const LOG_PATH = path.join(os.homedir(), ".apx", "daemon.log");

export async function cmdDaemonStart() {
  await ensureDaemon();
  const status = await http.get("/health");
  console.log(`apx daemon ${status.version} listening (uptime ${status.uptime_s}s)`);
}

export async function cmdDaemonStatus() {
  if (!(await http.ping())) {
    console.log(`stopped   (no daemon on port ${process.env.APX_PORT || 7430})`);
    process.exit(1);
  }
  const h = await http.get("/health", { autoStart: false });
  const projects = await http.get("/projects", { autoStart: false });
  const pid = fs.existsSync(PID_PATH) ? fs.readFileSync(PID_PATH, "utf8").trim() : "?";
  console.log(`running   pid=${pid}  port=${process.env.APX_PORT || 7430}  uptime=${h.uptime_s}s  version=${h.version}`);
  if (projects.length === 0) {
    console.log("projects: (none registered)");
  } else {
    console.log("projects:");
    for (const p of projects) {
      console.log(`  ${p.id}  ${p.path}    ${p.agents} agents`);
    }
  }
}

export async function cmdDaemonStop() {
  if (!(await http.ping())) {
    console.log("apx daemon not running");
    return;
  }
  try {
    await http.post("/admin/shutdown", undefined, { autoStart: false });
    console.log("apx daemon stopped");
  } catch (e) {
    if (fs.existsSync(PID_PATH)) {
      try {
        const pid = parseInt(fs.readFileSync(PID_PATH, "utf8"), 10);
        if (pid) {
          process.kill(pid);
          console.log(`apx daemon stopped (pid ${pid})`);
          return;
        }
      } catch {}
    }
    console.log("apx daemon not running");
  }
}

export function cmdDaemonLogs(args) {
  if (!fs.existsSync(LOG_PATH)) {
    console.log(`(no log at ${LOG_PATH})`);
    return;
  }
  const tail = args.flags.tail ? parseInt(args.flags.tail, 10) : 50;
  const text = fs.readFileSync(LOG_PATH, "utf8");
  const lines = text.split("\n");
  const slice = lines.slice(-tail - 1);
  process.stdout.write(slice.join("\n"));
}
