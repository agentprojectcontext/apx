// When the core does not answer, the terminal is what is left: `apx doctor` finds out why from this machine (the
// service, the core's log, the release feed) and `apx update` brings in a newer bundle without the core. Both work
// with the core down, so they cannot go through the protocol. See HISTORY.md#cli-without-core.
import fs from "node:fs";
import path from "node:path";
import { coreBundleName, type Platform, platformOf, RELEASE_FEED, type Release } from "@apx/protocol";
import {
  checkReleases,
  commandRunner,
  currentVersion,
  installRelease,
  type Runner,
} from "../../../../packages/install/src/release.ts";
import { themedCard as card } from "../presentation.ts";
import { version as cliVersion } from "./admin.ts";
import { apxHome, localConnection } from "./local.ts";
import { lastLines, restart, serviceState } from "./service.ts";
import { appRoot, coreMain } from "./service-files.ts";

export type Install = { kind: "bundle"; app: string; version?: string | undefined } | { kind: "checkout" | "app" };
export type ServiceState = "running" | "stopped" | "none" | "unknown";
export type DoctorFacts = {
  url: string;
  install: Install;
  /** What the core said on /health; undefined when it did not answer. */
  core?: { version: string; code_sha: string } | undefined;
  service: ServiceState;
  /** The last lines of <home>/logs/core.log, when there is one. */
  log?: string[] | undefined;
  /** A newer release with a build for this computer. */
  latest?: string | undefined;
  /** Where to download the desktop app or a bundle by hand. */
  releases: string;
};

/** What the log says about the core's last start, when it is something known: its cause and what to do. */
export function logCause(lines: string[], port: string): { cause: string; fix: string } | undefined {
  const started = lines.findLastIndex((l) => l.includes("apx core listening"));
  const since = lines.slice(started + 1).join("\n");
  if (since.includes("ERR_MODULE_NOT_FOUND"))
    return { cause: "This APX version is missing files, so its core cannot start.", fix: "update" };
  if (since.includes("EADDRINUSE"))
    return {
      cause: `Another program already uses port ${port}.`,
      fix: `See which one: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    };
  return undefined;
}

/** What is wrong and what to run next, from what this machine shows. */
export function diagnose(f: DoctorFacts): { ok: boolean; lines: string[]; next: string[] } {
  const port = new URL(f.url).port || "7440";
  const installed =
    f.install.kind === "bundle"
      ? `Installed: APX ${f.install.version ?? "(unknown version)"} in ${f.install.app}`
      : f.install.kind === "checkout"
        ? "Installed: run from a source checkout"
        : "Installed: inside the desktop app";
  const service = {
    running: "Service: running",
    stopped: "Service: installed, not running",
    none: "Service: not installed",
    unknown: "Service: could not be read",
  }[f.service];
  const update =
    f.install.kind === "bundle"
      ? "apx update"
      : f.install.kind === "checkout"
        ? "git pull && pnpm install, then start it again"
        : `Download the newest APX app: ${f.releases}`;
  const newer = f.latest ? [`Newer: APX ${f.latest} is out`] : [];
  if (f.core)
    return {
      ok: true,
      lines: [`Core: answers on ${f.url} · APX ${f.core.version} · ${f.core.code_sha}`, installed, service, ...newer],
      next: f.latest ? [update] : [],
    };
  const cause = f.log ? logCause(f.log, port) : undefined;
  const next = cause
    ? [cause.fix === "update" ? update : cause.fix]
    : f.latest
      ? [update]
      : f.install.kind === "bundle" && f.service === "none"
        ? ["apx service install"]
        : f.service === "stopped"
          ? ["apx service restart"]
          : ["Read the log: apx service logs -n 100"];
  return {
    ok: false,
    lines: [
      `Core: does not answer on ${f.url}`,
      ...(cause ? [`Why: ${cause.cause}`] : f.log ? [] : ["Log: the core has not written one on this home yet"]),
      installed,
      service,
      ...newer,
    ],
    next,
  };
}

/** The newest of `newer` with this computer's bundle. */
export function newestFor(newer: Release[], platform: Platform): Release | undefined {
  return newer.find((r) => r.assets.some((a) => a.name === coreBundleName(r.version, platform)));
}

/** Puts the newest bundle in place without the core, then has the service start it. */
export async function updateWithoutCore(o: {
  app: string;
  feed: string;
  current: string;
  platform: Platform;
  fetch: typeof fetch;
  run: Runner;
  service: ServiceState;
  restart(): Promise<void>;
}): Promise<string[]> {
  const release = newestFor((await checkReleases(o.feed, o.current, o.fetch)).newer, o.platform);
  if (!release) return [`APX ${o.current} is the newest for this computer.`, "To see why the core stops: apx doctor"];
  const done = await installRelease({ app: o.app, release, platform: o.platform, fetch: o.fetch, run: o.run });
  if (o.service === "none") return [`APX ${release.version} is installed (${done}).`, "Start it: apx service install"];
  await o.restart();
  return [`APX ${release.version} is installed (${done}).`, "The service is starting it: apx status"];
}

const feedOf = (env: NodeJS.ProcessEnv) => env.APX_RELEASES || RELEASE_FEED;
const releasesPage = (feed: string) =>
  /^https?:\/\//.test(feed) ? feed : `https://github.com/${feed}/releases/latest`;

function installOf(env: NodeJS.ProcessEnv): Install {
  if (env.APX_APP) return { kind: "bundle", app: env.APX_APP, version: currentVersion(env.APX_APP) };
  return fs.existsSync(path.join(appRoot(coreMain()), ".git")) ? { kind: "checkout" } : { kind: "app" };
}

const installedVersion = (install: Install) =>
  (install.kind === "bundle" ? install.version : undefined) ?? /· ([\d.]+) ·/.exec(cliVersion())?.[1] ?? "0.0.0";

async function health(url: string): Promise<DoctorFacts["core"]> {
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return undefined;
    const body = (await r.json()) as { result?: { version?: string; code_sha?: string } };
    return { version: body.result?.version ?? "?", code_sha: body.result?.code_sha ?? "?" };
  } catch {
    return undefined;
  }
}

async function newestOnline(feed: string, current: string, platform: Platform | undefined) {
  if (!platform || feed === "off") return undefined;
  try {
    return newestFor((await checkReleases(feed, current, fetch)).newer, platform)?.version;
  } catch {
    return undefined;
  }
}

/** `apx doctor`: why the core does not answer here, and the one thing to run next. */
export async function doctor(o: { json?: boolean | undefined; env?: NodeJS.ProcessEnv }): Promise<void> {
  const env = o.env ?? process.env;
  const { url } = localConnection(env);
  const install = installOf(env);
  const feed = feedOf(env);
  const file = path.join(apxHome(env), "logs", "core.log");
  const facts: DoctorFacts = {
    url,
    install,
    core: await health(url),
    service: serviceState(),
    log: fs.existsSync(file) ? lastLines(file, 200) : undefined,
    latest: await newestOnline(feed, installedVersion(install), platformOf(process.platform, process.arch)),
    releases: releasesPage(feed),
  };
  const d = diagnose(facts);
  if (o.json) console.log(JSON.stringify({ ...d, facts: { ...facts, log: undefined } }, null, 2));
  else console.log(card("APX doctor", [...d.lines, ...d.next.map((n) => `Next: ${n}`)]));
  if (!d.ok) process.exitCode = 1;
}

/** `apx update` when the core does not answer: a bundle install updates itself; others are told how. */
export async function updateOffline(o: { check?: boolean | undefined; env?: NodeJS.ProcessEnv }): Promise<void> {
  const env = o.env ?? process.env;
  const install = installOf(env);
  const feed = feedOf(env);
  const platform = platformOf(process.platform, process.arch);
  if (install.kind !== "bundle" || !platform) {
    const how =
      install.kind === "checkout"
        ? "This APX runs from a source checkout: git pull && pnpm install, then start it again."
        : `This APX runs inside the desktop app: download the newest one from ${releasesPage(feed)}`;
    console.log(card("APX update", ["The core does not answer, so it cannot update itself.", how]));
    return;
  }
  const current = installedVersion(install);
  if (o.check) {
    const latest = await newestOnline(feed, current, platform);
    console.log(
      card("APX updates", [latest ? `APX ${latest} is out (this is ${current})` : `APX ${current} is the newest`]),
    );
    return;
  }
  console.log(`The core does not answer: updating APX ${current} without it…`);
  const lines = await updateWithoutCore({
    app: install.app,
    feed,
    current,
    platform,
    fetch,
    run: commandRunner(install.app),
    service: serviceState(),
    restart,
  });
  console.log(card("APX update", lines));
}
