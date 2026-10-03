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
import { fakeTelegram } from "../apps/core/src/channels/fake-telegram.test-support.ts";
import { fakeLlm } from "./fake-llm.ts";
import { writeFixtures } from "./fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
export const E2E = {
  port: Number(process.env.E2E_PORT ?? 7460),
  control: Number(process.env.E2E_CONTROL_PORT ?? 7461),
  telegramToken: "123456789:AAE2eFakeTokenForTheEmulatedBot0",
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-"));
const fx = writeFixtures(dir);
const llm = await fakeLlm();
const tg = await fakeTelegram(E2E.telegramToken);

const core = spawn(process.execPath, ["--no-warnings", path.join(root, "apps/core/src/main.ts")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? os.homedir(),
    APX_HOME: fx.home,
    APX_PORT: String(E2E.port),
    APX_SECRETS: "file",
    APX_V1_HOME: fx.v1,
    APX_V1_URL: "http://127.0.0.1:9",
    CLAUDE_CONFIG_DIR: fx.claude,
    CODEX_HOME: fx.codex,
    APX_LLM_BASE_URL: llm.url,
    APX_LLM_KEY: "e2e",
    APX_LLM_MODELS: "fake-1",
    APX_TELEGRAM_API: tg.url,
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
      return json(200, { dir, repo: fx.repo, token: E2E.telegramToken, core: `http://127.0.0.1:${E2E.port}` });
    if (req.url === "/tg/message" && req.method === "POST") {
      tg.message(body.from as { id: number; name: string }, String(body.text ?? ""));
      return json(200, { ok: true });
    }
    if (req.url?.startsWith("/tg/sent")) {
      const chat = new URL(req.url, "http://x").searchParams.get("chat");
      return json(200, { sent: chat ? tg.messagesTo(Number(chat)).map((s) => s.body) : tg.sent });
    }
    if (req.url === "/llm/calls") return json(200, { calls: llm.calls.length });
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
  await Promise.all([llm.close(), tg.close(), new Promise((r) => control.close(r))]);
  if (!process.env.E2E_KEEP) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
core.on("exit", (code) => {
  if (code) console.error(`apx e2e: the core stopped (${code}); see ${path.join(dir, "core.log")}`);
});
