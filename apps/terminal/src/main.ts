#!/usr/bin/env node
// The terminal owns no domain logic: every command is a protocol call to the core.
import { parseArgs } from "node:util";
import { ApxClient, ApxError } from "@apx/protocol/client";

const HELP = `apx2 — APX v2 terminal

Usage:
  apx2 status [--json]     Is the core up, and is it running my code?
  apx2 ping [text]         Round-trip over the live socket

  apx2 browser tabs
  apx2 browser open <url> [--profile shared|incognito|agent:<id>] [--by <agent>]
  apx2 browser nav <tab> <url>
  apx2 browser snapshot <tab>
  apx2 browser click <tab> <ref>
  apx2 browser type <tab> <ref> <text> [--submit]
  apx2 browser shot <tab> <file.jpg>
  apx2 browser close <tab>
  apx2 browser control <tab> user|idle|done

  apx2 chat "<text>" [--thread home]   Talk to an agent; prints tool steps and the answer
  apx2 import-v1                       Import projects and agents from a running APX v1 (read-only)

  apx2 mcp [--by <agent>]  Stdio MCP server exposing browser_* tools (for Claude Code, Codex…)

Env: APX_URL (default http://127.0.0.1:7440), APX_TOKEN`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    profile: { type: "string" },
    by: { type: "string" },
    submit: { type: "boolean" },
    thread: { type: "string" },
  },
});
const [command, ...rest] = positionals;
const client = new ApxClient({
  url: process.env.APX_URL ?? "http://127.0.0.1:7440",
  ...(process.env.APX_TOKEN ? { token: process.env.APX_TOKEN } : {}),
  client: { name: "apx2-terminal", version: "0.0.0" },
});

try {
  switch (values.help ? "help" : command) {
    case "status": {
      const h = await client.call("system.health", {});
      if (values.json) {
        console.log(JSON.stringify(h, null, 2));
        break;
      }
      console.log(`apx core ${h.version} · ${h.code_sha} · up ${h.uptime_s}s`);
      for (const [name, s] of Object.entries(h.subsystems))
        console.log(`  ${name.padEnd(12)} ${s.status}${s.detail ? ` — ${s.detail}` : ""}`);
      break;
    }
    case "ping": {
      const socket = await client.connect();
      const r = await socket.call("system.ping", rest[0] ? { echo: rest[0] } : {});
      console.log(`${r.pong} (${r.at})`);
      socket.close();
      break;
    }
    case "browser":
      await browser(rest);
      break;
    case "chat":
      await chat(rest.join(" "), values.thread ?? "home");
      break;
    case "import-v1": {
      const r = await client.call("system.import_v1", {});
      console.log(`imported ${r.projects} projects, ${r.agents} agents`);
      break;
    }
    case "mcp": {
      const { runMcp } = await import("./mcp.ts");
      await runMcp(client, values.by ?? "mcp-client");
      break;
    }
    default:
      console.log(HELP);
      process.exitCode = command && command !== "help" ? 1 : 0;
  }
} catch (err) {
  if (err instanceof ApxError) console.error(`apx2: ${err.code}: ${err.message}`);
  else if (err instanceof TypeError && String(err.cause ?? "").includes("ECONNREFUSED"))
    console.error("apx2: the core is not running (try: pnpm dev)");
  else console.error(`apx2: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}

async function browser([sub, a, b, c]: string[]): Promise<void> {
  const by = values.by ?? "terminal";
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Error(`missing ${what} (see apx2 --help)`);
    return v;
  };
  switch (sub) {
    case "tabs": {
      const { tabs } = await client.call("browser.tabs", {});
      for (const t of tabs)
        console.log(`${t.tab}\t${t.profile}\t${t.control.kind === "agent" ? t.control.by : t.control.kind}\t${t.url}`);
      if (!tabs.length) console.log("(no tabs)");
      return;
    }
    case "open": {
      const t = await client.call("browser.open", {
        url: need(a, "url"),
        ...(values.profile ? { profile: values.profile } : {}),
        by,
      });
      console.log(`${t.tab} · ${t.profile} · ${t.title || t.url}`);
      return;
    }
    case "nav": {
      const r = await client.call("browser.navigate", { tab: need(a, "tab"), url: need(b, "url"), by });
      console.log(`${r.title} · ${r.url}`);
      return;
    }
    case "snapshot": {
      const s = await client.call("browser.snapshot", { tab: need(a, "tab") });
      console.log(s.tree);
      console.log(`\n${s.refs} refs${s.truncated ? " (truncated)" : ""} · ${s.url}`);
      return;
    }
    case "click": {
      const r = await client.call("browser.click", { tab: need(a, "tab"), ref: need(b, "ref"), by });
      console.log(`ok · ${r.url}`);
      return;
    }
    case "type": {
      const r = await client.call("browser.type", {
        tab: need(a, "tab"),
        ref: need(b, "ref"),
        text: need(c, "text"),
        submit: values.submit ?? false,
        by,
      });
      console.log(`ok · ${r.url}`);
      return;
    }
    case "shot": {
      const r = await client.call("browser.screenshot", { tab: need(a, "tab") });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(need(b, "file"), Buffer.from(r.data, "base64"));
      console.log(`wrote ${b} (${r.bytes} bytes)`);
      return;
    }
    case "control": {
      const mode = need(b, "mode");
      if (mode !== "user" && mode !== "idle" && mode !== "done") throw new Error("mode must be user, idle or done");
      const t = await client.call("browser.control", { tab: need(a, "tab"), mode });
      console.log(`${t.tab} · ${t.control.kind}`);
      return;
    }
    case "close":
      await client.call("browser.close", { tab: need(a, "tab") });
      console.log("closed");
      return;
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

async function chat(text: string, thread: string): Promise<void> {
  if (!text) throw new Error('usage: apx2 chat "<text>"');
  const socket = await client.connect();
  const printed = new Set<string>();
  const done = new Promise<void>((resolve) => {
    socket.onEvent((e) => {
      const ev = e.payload as {
        type: string;
        message?: { thread_id: string; author: { kind: string }; parts: Array<Record<string, unknown>> };
        run?: { thread_id: string; state: string; error?: string };
      };
      if (
        (ev.type === "message.updated" || ev.type === "message.created") &&
        ev.message?.thread_id === thread &&
        ev.message.author.kind === "agent"
      ) {
        for (const p of ev.message.parts) {
          const key =
            p.type === "tool"
              ? `${p.call_id}:${p.status}`
              : p.type === "text"
                ? `text:${p.text}`
                : `${p.type}:${JSON.stringify(p)}`;
          if (printed.has(key) || (p.type === "tool" && p.status === "running")) continue;
          printed.add(key);
          if (p.type === "tool") console.log(`  ${p.status === "ok" ? "✓" : "✗"} ${p.title}`);
          else if (p.type === "subthread")
            console.log(`  ↳ ${p.state} · ${p.title}${p.summary ? ` — ${String(p.summary).slice(0, 80)}` : ""}`);
          else if (p.type === "surface") console.log(`  ▣ widget: ${p.title} (v${p.version})`);
          else if (p.type === "browser") console.log(`  ◎ browser ${p.state}: ${p.url}`);
        }
      }
      if (
        ev.type === "run.updated" &&
        ev.run?.thread_id === thread &&
        ["completed", "failed", "canceled"].includes(ev.run.state)
      )
        resolve();
    });
  });
  await socket.call("threads.send", { thread, text });
  await done;
  const { messages } = await socket.call("threads.get", { thread });
  const last = messages.at(-1);
  const answer = last?.parts.find((p) => p.type === "text");
  console.log(
    `\n${answer && answer.type === "text" ? answer.text : "(no text)"}${last?.model ? `\n— ${last.model}` : ""}`,
  );
  socket.close();
}
