#!/usr/bin/env node
// A whole APX apart from the owner's: its own core on its own port and home (a temp folder), a model that answers
// without calling anyone, an emulated Telegram, an APX v1 and Claude Code sessions to import, and a project folder.
// Nothing here touches ~/.apx, the Keychain or a real service. Playwright starts it (webServer); `node e2e/env.ts`
// runs it by hand. A small control API lets tests act as the outside world (a Telegram user writing).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fakeDiscord } from "../apps/core/src/channels/fake-discord.test-support.ts";
import { fakeSlack } from "../apps/core/src/channels/fake-slack.test-support.ts";
import { fakeTelegram } from "../apps/core/src/channels/fake-telegram.test-support.ts";
import { fakeGoogle } from "../apps/core/src/integrations/fake-google.test-support.ts";
import { compileCacheEnv } from "../scripts/compile-cache.ts";
import { fakeLlm } from "./fake-llm.ts";
import { writeFixtures } from "./fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
export const E2E = {
  port: Number(process.env.E2E_PORT ?? 7460),
  control: Number(process.env.E2E_CONTROL_PORT ?? 7461),
  /** The emulated phone for WhatsApp (e2e/fake-baileys.ts), inside the core's process. */
  whatsapp: Number(process.env.E2E_WA_PORT ?? 7462),
  telegramToken: "123456789:AAE2eFakeTokenForTheEmulatedBot0",
  discordToken: "MTIzNDU2Nzg5MDEyMzQ1Njc4.GfAkE1.e2eFakeTokenForTheEmulatedDiscordBot",
  slackTokens: { bot: "xoxb-1234-e2e-fake-bot", app: "xapp-1-e2e-fake-app" },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-"));
const llm = await fakeLlm();
// v1's embedding engine is the fake model's server (Ollama-style), never one running on this machine.
const fx = writeFixtures(dir, { embedUrl: llm.url.replace(/\/v1$/, "") });
const tg = await fakeTelegram(E2E.telegramToken);
const dc = await fakeDiscord(E2E.discordToken);
// The bot's server: a room it may write in, and an announcements room whose overwrite takes "Send messages" from it.
dc.guild.channels = [
  { id: "100000000000000001", name: "general", type: 0 },
  {
    id: "100000000000000002",
    name: "anuncios",
    type: 5,
    permission_overwrites: [{ id: "7001", type: 0, allow: "0", deny: String(1 << 11) }],
  },
];
const sl = await fakeSlack(E2E.slackTokens);
const google = await fakeGoogle();

const hook = path.join(root, "e2e/baileys-hook.ts");
const desktopTrashRecord = path.join(dir, "desktop-trash.jsonl");
const core = spawn(process.execPath, ["--no-warnings", "--import", hook, path.join(root, "e2e/start-core.ts")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    // Only the sandbox's own CLIs, node and the system: none of the machine's agents (claude, codex, opencode…).
    PATH: [fx.bin, "/usr/bin", "/bin"].join(path.delimiter),
    HOME: process.env.HOME ?? os.homedir(),
    ...compileCacheEnv(root),
    APX_HOME: fx.home,
    APX_PORT: String(E2E.port),
    // Browser regression tests resolve this insecure origin to loopback. Only allowed as an origin: a public URL
    // would make the core count as exposed, and Devices would ask for a restart it never needs.
    APX_ALLOWED_ORIGINS: `http://panel.test:${E2E.port}`,
    APX_SECRETS: "file",
    APX_UPDATES: "off",
    // A sandbox never reports to the APX project.
    APX_TELEMETRY: "off",
    APX_AGENT_NAME: "Roby",
    APX_V1_HOME: fx.v1,
    APX_V1_URL: "http://127.0.0.1:9",
    CLAUDE_CONFIG_DIR: fx.claude,
    // Never the owner's other agent apps' skills (~/.cursor, ~/.agents).
    APX_APPS_HOME: dir,
    CODEX_HOME: fx.codex,
    APX_LLM_BASE_URL: llm.url,
    APX_LLM_KEY: "e2e",
    APX_LLM_MODELS: "fake-1,fake-2",
    APX_TELEGRAM_API: tg.url,
    APX_DISCORD_API: dc.urls.api,
    APX_DISCORD_GATEWAY: dc.urls.gateway,
    APX_SLACK_API: sl.api,
    APX_GOOGLE_API: google.url,
    // Never the owner's own Messages, even when the sandbox runs on their Mac.
    APX_IMESSAGE: "off",
    // Never the machine's own Ollama: memory's local embedding models are looked for where nothing answers.
    APX_OLLAMA_URL: "http://127.0.0.1:9",
    E2E_WA_PORT: String(E2E.whatsapp),
    E2E_DESKTOP_TRASH_RECORD: desktopTrashRecord,
    E2E_PROJECT_ROOT: fx.repo,
  },
});
const log = fs.createWriteStream(path.join(dir, "core.log"));
core.stdout.pipe(log);
core.stderr.pipe(log);

/** The outside world for the tests: a Telegram user writing, what the bot sent, where things are. */
const control = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    if (req.url === "/info")
      return json(200, {
        dir,
        repo: fx.repo,
        home: fx.home,
        token: E2E.telegramToken,
        discord: E2E.discordToken,
        slack: E2E.slackTokens,
        core: `http://127.0.0.1:${E2E.port}`,
        llm: llm.url.replace(/\/v1$/, ""),
      });
    if (req.url === "/tg/message" && req.method === "POST") {
      // In a group: its chat, and what the message carries (an @mention's entities).
      const chat = body.chat as { id: number; type: string; title: string } | undefined;
      const extra = (body.extra ?? {}) as Record<string, unknown>;
      tg.message(body.from as { id: number; name: string }, String(body.text ?? ""), chat, extra);
      return json(200, { ok: true });
    }
    if (req.url?.startsWith("/tg/sent")) {
      const chat = new URL(req.url, "http://x").searchParams.get("chat");
      return json(200, { sent: chat ? tg.messagesTo(Number(chat)).map((s) => s.body) : tg.sent });
    }
    if (req.url?.startsWith("/tg/drafts")) {
      const chat = new URL(req.url, "http://x").searchParams.get("chat");
      const drafts = tg.sent.filter((s) => s.method === "sendMessageDraft" && String(s.body.chat_id) === chat);
      return json(200, { drafts: drafts.map((s) => s.body) });
    }
    // Discord and Slack: someone writing to the bot in a direct message, and what the bot sent to them.
    if (req.url === "/dc/message" && req.method === "POST") {
      const room = typeof body.room === "string" ? body.room : undefined;
      dc.message(body.from as { id: string; name: string }, String(body.text ?? ""), room ? { room } : {});
      return json(200, { ok: true });
    }
    if (req.url?.startsWith("/dc/room")) {
      const room = new URL(req.url, "http://x").searchParams.get("room") ?? "";
      return json(200, {
        sent: dc.messagesTo(room).map((s) => ({ text: s.body.content, reply: Boolean(s.body.message_reference) })),
      });
    }
    if (req.url?.startsWith("/dc/sent")) {
      const user = new URL(req.url, "http://x").searchParams.get("user") ?? "";
      return json(200, { sent: dc.messagesTo(dc.dm(user)).map((s) => ({ text: s.body.content })) });
    }
    if (req.url === "/sl/message" && req.method === "POST") {
      sl.message(body.from as { id: string }, String(body.text ?? ""));
      return json(200, { ok: true });
    }
    if (req.url?.startsWith("/sl/sent")) {
      const user = new URL(req.url, "http://x").searchParams.get("user") ?? "";
      return json(200, { sent: sl.messagesTo(sl.dm(user)).map((s) => ({ text: s.body.text })) });
    }
    if (req.url === "/llm/calls") return json(200, { calls: llm.calls.length });
    if (req.url === "/desktop/trash")
      return json(200, {
        paths: fs.existsSync(desktopTrashRecord)
          ? fs
              .readFileSync(desktopTrashRecord, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [],
      });
    json(404, { error: "no such control" });
  });
});
control.listen(E2E.control, "127.0.0.1");

// Ready when the core answers.
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${E2E.port}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
// Every agent answers with the fake model unless a test picks another.
await fetch(`http://127.0.0.1:${E2E.port}/rpc/models.set_config`, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": "e2e-model" },
  body: JSON.stringify({ default: { model: "custom/fake-1", router: false } }),
});
console.log(
  `apx e2e: core http://127.0.0.1:${E2E.port} · control :${(control.address() as AddressInfo).port} · ${dir}`,
);

const stop = async () => {
  core.kill("SIGTERM");
  await Promise.all([llm.close(), tg.close(), google.close(), new Promise((r) => control.close(r))]);
  if (!process.env.E2E_KEEP) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
core.on("exit", (code) => {
  if (code) console.error(`apx e2e: the core stopped (${code}); see ${path.join(dir, "core.log")}`);
});
