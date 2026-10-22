import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { ApxClient } from "@apx/protocol/client";
import { themedCard as card, clean, duration, rememberTheme } from "../presentation.ts";
import { apxHome, localConnection } from "./local.ts";
import { pair } from "./pair.ts";

type Options = { json?: boolean | undefined; plain?: boolean | undefined; check?: boolean | undefined };

export function version(json = false): string {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  let sha = "unknown";
  const root = path.resolve(import.meta.dirname, "../../../..");
  try {
    const build = JSON.parse(fs.readFileSync(path.join(root, "build.json"), "utf8")) as { sha: string };
    sha = build.sha;
  } catch {
    try {
      sha = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {}
  }
  return json
    ? JSON.stringify({ name: "apx", generation: 2, version: pkg.version, code_sha: sha }, null, 2)
    : `APX v2 · ${pkg.version === "0.0.0" ? "development" : pkg.version} · ${sha}`;
}

export async function status(client: ApxClient, o: Options): Promise<void> {
  const h = await client.call("system.health", {});
  if (o.json) {
    console.log(JSON.stringify(h, null, 2));
    return;
  }
  const results = await Promise.allSettled([
    client.call("agents.list", {}),
    client.call("projects.list", {}),
    client.call("mcp.list", {}),
    client.call("devices.list", {}),
    client.call("access.get", {}),
    client.call("threads.list", {}),
  ]);
  const [agents, projects, mcp, devices, access, threads] = results;
  const boss = agents?.status === "fulfilled" ? agents.value.agents.find((a) => a.kind === "secretary") : undefined;
  if (boss) rememberTheme(apxHome(), { name: boss.name, blob: boss.blob ?? "ovni" });
  const lines = [
    `Core: ${h.version === "0.0.0" ? "v2 development" : h.version} · ${h.code_sha}`,
    `Uptime: ${duration(h.uptime_s)} · Memory: ${h.rss_mb ?? "?"} MB`,
    `URL: ${localConnection().url}`,
    ...Object.entries(h.subsystems).map(([k, v]) => `${k}: ${v.status}${v.detail ? ` · ${v.detail}` : ""}`),
    "",
    agents?.status === "fulfilled"
      ? `Crew: ${agents.value.agents.length} agents · Home: ${boss?.name ?? "APX"}${boss?.blob ? ` · ${boss.blob}` : ""}`
      : "Crew: unavailable",
    projects?.status === "fulfilled" ? `Projects: ${projects.value.projects.length}` : "Projects: unavailable",
    mcp?.status === "fulfilled"
      ? `MCP: ${mcp.value.servers.length} servers · ${mcp.value.servers.filter((s) => s.status === "ready").length} ready · ${mcp.value.servers.filter((s) => s.status === "needs-approval").length} need approval`
      : "MCP: unavailable",
    devices?.status === "fulfilled" ? `Devices: ${devices.value.devices.length} paired` : "Devices: unavailable",
    access?.status === "fulfilled"
      ? `Access: ${access.value.mode}${access.value.restart_needed ? ` · Restart needed (saved: ${access.value.saved})` : ""} · Tailscale: ${access.value.tailscale.connected ? "connected" : access.value.tailscale.installed ? "disconnected" : "not installed"}`
      : "Access: unavailable",
    threads?.status === "fulfilled"
      ? `Chats: ${threads.value.threads.length} listed · ${threads.value.threads.filter((t) => t.kind === "code").length} code`
      : "Chats: unavailable",
  ];
  if (o.plain || (process.stdout.columns && process.stdout.columns < 50)) console.log(lines.map(clean).join("\n"));
  else console.log(card("Status", lines));
}

export async function admin(client: ApxClient, command: string, rest: string[], o: Options): Promise<void> {
  if (command === "devices") {
    const [sub = "list", id] = rest;
    if (sub === "pair") return pair(client);
    if (sub === "revoke") {
      if (!id) throw new Error("usage: apx devices revoke <id>");
      const r = await client.call("devices.revoke", { id });
      console.log(r.revoked ? `Revoked ${clean(id)}` : "Device not found");
      return;
    }
    if (sub !== "list") throw new Error("usage: apx devices [list|pair|revoke <id>]");
    const r = await client.call("devices.list", {});
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else
      console.log(
        card(
          "Devices",
          r.devices.length
            ? r.devices.map((d) => `${d.name} · ${d.platform} · ${d.id}\nLast seen: ${d.last_seen_at ?? "never"}`)
            : ["No paired devices", "Connect: apx tailscale connect, then apx devices pair"],
        ),
      );
    return;
  }
  if (command === "tailscale") {
    const [sub = "status"] = rest;
    if (sub === "status") {
      const r = await client.call("access.get", {});
      console.log(
        o.json
          ? JSON.stringify(r, null, 2)
          : card("Tailscale", [
              `Installed: ${r.tailscale.installed}`,
              `Connected: ${r.tailscale.connected}`,
              `Access: ${r.mode} · Saved: ${r.saved}`,
              ...r.urls,
              ...(r.restart_needed ? ["Restart needed: apx service restart"] : []),
            ]),
      );
      return;
    }
    if (sub !== "connect" && sub !== "off") throw new Error("usage: apx tailscale status|connect|off");
    const r = await client.call("access.set", { mode: sub === "connect" ? "tailscale" : "local" });
    console.log(
      o.json
        ? JSON.stringify(r, null, 2)
        : card("Access saved", [
            `Mode: ${r.saved}`,
            ...r.urls,
            r.restarting ? "Core restarting" : r.restart_needed ? "Restart: apx service restart" : "Ready",
          ]),
    );
    return;
  }
  if (rest.length > 1 || (rest[0] && rest[0] !== "check")) throw new Error("usage: apx upgrade [--check] [--json]");
  const r = await client.call("system.updates", { check: true });
  if (o.check || rest[0] === "check") {
    console.log(
      o.json
        ? JSON.stringify(r, null, 2)
        : card("APX updates", [
            `Source: ${r.source}`,
            r.error ?? (r.behind ? `${r.behind} updates available · ${r.latest ?? ""}` : "Up to date"),
            ...r.changes,
          ]),
    );
    if (r.error) process.exitCode = 1;
    return;
  }
  if (r.error) throw new Error(r.error);
  if (r.source === "none" || r.source === "app")
    throw new Error("This install uses the desktop updater; open Settings > About");
  if (!r.behind) {
    console.log(o.json ? JSON.stringify(r, null, 2) : "Up to date");
    return;
  }
  const result = await client.call("system.update", {});
  console.log(
    o.json
      ? JSON.stringify(result, null, 2)
      : card("APX upgrade", [
          result.ok ? "Updated" : "Update failed",
          result.log,
          ...(result.ok ? [result.restart ? "Core restarting" : "Restart APX to load the update"] : []),
        ]),
  );
  if (!result.ok) process.exitCode = 1;
}

export async function wizard(client: ApxClient): Promise<void> {
  if (!process.stdin.isTTY)
    throw new Error(
      "Wizard needs an interactive terminal. Server setup: apx setup --headless; desktop setup: open the APX panel",
    );
  try {
    const { agents } = await client.call("agents.list", {});
    const boss = agents.find((a) => a.kind === "secretary");
    if (boss) rememberTheme(apxHome(), { name: boss.name, blob: boss.blob ?? "ovni" });
  } catch {}
  const commands = ["/status", "/devices", "/tailscale", "/connect", "/pair", "/updates", "/panel", "/help", "/quit"];
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string): [string[], string] => [commands.filter((c) => c.startsWith(line)), line],
  });
  let closed = false;
  const runner = consoleCommands(client);
  rl.on("SIGINT", () => {
    process.exitCode = 130;
    rl.close();
  });
  // Never process.exit here: exiting while a request is still open can crash Node on Windows (a libuv assertion).
  rl.on("close", () => {
    closed = true;
    runner.cancel();
  });
  const menu = () =>
    console.log(
      card("Console", [
        "/status     Core, crew and projects",
        "/devices    Paired devices",
        "/tailscale  Network access",
        "/connect    Expose APX through Tailscale",
        "/pair       Connect a new device",
        "/updates    Check for a newer APX",
        "/panel      Open the web panel address",
        "",
        "Tab to complete · ↑↓ history",
        "/help menu · /quit exit",
        "",
        "Background core: apx service status",
      ]),
    );
  try {
    menu();
    while (!closed) {
      let choice: string;
      try {
        choice = (await rl.question("apx › ")).trim();
      } catch {
        break;
      }
      const aliases: Record<string, string> = {
        "1": "/status",
        "2": "/devices",
        "3": "/connect",
        "4": "/pair",
        "5": "/updates",
        "6": "/panel",
        "0": "/quit",
      };
      choice = aliases[choice] ?? choice;
      if (!choice) continue;
      if (choice === "/quit" || choice === "exit") break;
      try {
        await runner.run((c) => consoleCommand(c, choice, menu));
      } catch (err) {
        if (!closed) console.error(card("Command failed", [err instanceof Error ? err.message : String(err)]));
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Runs one console command at a time on a client of its own, so `cancel` (the console closing) aborts the
 * request still in flight and Node can exit on its own.
 */
export function consoleCommands(client: ApxClient) {
  let current: AbortController | undefined;
  return {
    async run(command: (client: ApxClient) => Promise<void>): Promise<void> {
      const controller = new AbortController();
      current = controller;
      try {
        await command(client.withSignal(controller.signal));
      } finally {
        if (current === controller) current = undefined;
      }
    },
    cancel(): void {
      current?.abort();
    },
  };
}

async function consoleCommand(client: ApxClient, choice: string, menu: () => void): Promise<void> {
  if (choice === "/status") await status(client, {});
  else if (choice === "/devices") await admin(client, "devices", [], {});
  else if (choice === "/tailscale") await admin(client, "tailscale", ["status"], {});
  else if (choice === "/connect") await admin(client, "tailscale", ["connect"], {});
  else if (choice === "/pair") await pair(client);
  else if (choice === "/updates") await admin(client, "upgrade", [], { check: true });
  else if (choice === "/panel") console.log(`Open the APX panel: ${localConnection().url}`);
  else if (choice === "/help") menu();
  else if (choice.startsWith("daemon") || choice.startsWith("/daemon"))
    console.log(card("Use service", ["Background core: apx service status", "Restart: apx service restart"]));
  else
    console.log(
      card("404 · Command not found", [
        `Unknown console command: ${choice}`,
        "Use /help to see commands; /quit to return to your shell.",
      ]),
    );
}
