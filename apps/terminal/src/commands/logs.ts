// apx logs: the core's log through the core (filtered there), so it works for a remote core too. With no core answering,
// the local file instead (`apx service logs`).
import type { ApxClient } from "@apx/protocol/client";
import { apxHome, coreUp } from "./local.ts";
import { logs as localLogs } from "./service.ts";

const LEVELS = ["info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

export type LogsOptions = {
  lines?: string | undefined;
  level?: string | undefined;
  grep?: string | undefined;
  scope?: string | undefined;
  json?: boolean | undefined;
};

export async function logsCommand(client: ApxClient, url: string, opts: LogsOptions): Promise<void> {
  const limit = Number(opts.lines ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("-n is a number of lines, 1 to 1000");
  if (opts.level && !LEVELS.includes(opts.level as Level)) throw new Error("--level is info, warn or error");
  if (!(await coreUp(url))) {
    console.error(`the core does not answer on ${url}: reading the log file on this computer`);
    return localLogs(apxHome(), limit, false);
  }
  const r = await client.call("system.logs", {
    limit,
    ...(opts.level ? { level: opts.level as Level } : {}),
    ...(opts.grep ? { q: opts.grep } : {}),
    ...(opts.scope ? { scope: opts.scope } : {}),
  });
  if (opts.json) return console.log(JSON.stringify(r, null, 2));
  console.log(`# ${r.path}`);
  if (!r.exists) return console.log("no log yet");
  for (const l of r.lines) console.log(formatLine(l));
}

export function formatLine(l: { t?: string; level: string; scope: string; msg: string; detail?: string }): string {
  const time = l.t ? localTime(new Date(l.t)) : " ".repeat(19);
  return [time, l.level.toUpperCase().padEnd(5), l.scope, l.msg, l.detail ?? ""].join("  ").trimEnd();
}

/** This computer's time, as `YYYY-MM-DD HH:MM:SS`: the log keeps UTC. */
function localTime(d: Date): string {
  if (Number.isNaN(d.getTime())) return " ".repeat(19);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
