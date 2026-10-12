#!/usr/bin/env node
// Retakes the docs' screenshots: a core of its own (temp home and HOME, port 7480, file secrets, a scripted model),
// the demo office from demo-seed.ts, and the panel in English in both themes, saved as src/assets/shots/*.webp.
// Nothing here touches ~/.apx, the Keychain or a real service. Needs `pnpm build:web` at the repo root first.
//   node --no-warnings scripts/shots.ts [name…]     (no names: every shot)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";
import { fakeTelegram } from "../../../apps/core/src/channels/fake-telegram.test-support.ts";
import { demoLlm } from "./demo-llm.ts";
import { seed, writeDemoWorld, writeHomeSkills } from "./demo-seed.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const out = path.resolve(import.meta.dirname, "../src/assets/shots");
const port = Number(process.env.SHOTS_PORT ?? 7480);
const core = `http://127.0.0.1:${port}`;
const only = new Set(process.argv.slice(2));
const log = (s: string) => console.log(s);

if (!fs.existsSync(path.join(root, "apps/web/dist/index.html"))) {
  console.error("Build the panel first: pnpm build:web (at the repo root).");
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-shots-"));
// A HOME of its own: no browser profiles, Claude or Codex sessions, v1 or Tailscale of the owner's show up.
const fakeHome = path.join(dir, "home");
// The example extension is copied into that HOME, so the screen shows "~/work/…" and not this checkout's path.
const extension = path.join(fakeHome, "work", "extensions", "daily-brief");
fs.cpSync(path.join(root, "examples/extensions/daily-brief"), extension, { recursive: true });
const world = { ...writeDemoWorld(fakeHome), extension };
writeHomeSkills(path.join(dir, "apx"));
// A tailscale that is not logged in, ahead of the real one in PATH (the core would show this machine's tailnet name).
const bin = path.join(dir, "bin");
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, "tailscale"), "#!/bin/sh\necho 'Logged out.' >&2\nexit 1\n", { mode: 0o755 });
const models = ["llama-3.3-70b", "qwen-2.5-coder-32b"];
const llm = await demoLlm(models);
const tgToken = "123456789:AAShotsFakeTokenForTheEmulatedBot";
const tg = await fakeTelegram(tgToken);

const child = spawn(process.execPath, ["--no-warnings", path.join(root, "apps/core/src/main.ts")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
    HOME: fakeHome,
    APX_PUBLIC_URL: "https://apx.example.com",
    APX_HOME: path.join(dir, "apx"),
    APX_PORT: String(port),
    APX_SECRETS: "file",
    APX_UPDATES: "off",
    APX_RELEASES: "off",
    APX_AGENT_NAME: "Nova",
    APX_V1_HOME: path.join(dir, "no-v1"),
    APX_V1_URL: "http://127.0.0.1:9",
    APX_IMESSAGE: "off",
    APX_HEADLESS: "off",
    CLAUDE_CONFIG_DIR: world.claude,
    CODEX_HOME: world.codex,
    APX_LLM_BASE_URL: llm.url,
    APX_LLM_KEY: "demo",
    APX_LLM_MODELS: models.join(","),
    APX_TELEGRAM_API: tg.url,
  },
});
const coreLog = fs.createWriteStream(path.join(dir, "core.log"));
child.stdout.pipe(coreLog);
child.stderr.pipe(coreLog);

let seq = 0;
async function rpc<T = Record<string, unknown>>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(`${core}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `shots-${Date.now()}-${seq++}` },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
  if (!body.ok) throw new Error(`${method}: ${body.error?.message}`);
  return body.result as T;
}

async function stop(code = 0) {
  child.kill("SIGTERM");
  await Promise.all([llm.close(), tg.close()]);
  if (!process.env.SHOTS_KEEP) fs.rmSync(dir, { recursive: true, force: true });
  else log(`kept ${dir}`);
  process.exit(code);
}

for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${core}/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
await rpc("models.set_config", { default: { model: `custom/${models[0]}`, router: false } });
log("seeding the demo office…");
const ids = await seed(rpc, world, log);
try {
  await rpc("channels.set", { id: "telegram", channel: { type: "telegram", agent_id: ids.home }, token: tgToken });
  tg.message({ id: 4242, name: "Carla Ruiz" }, "Hi! Are we still on for the catalog shoot on Thursday?");
} catch (e) {
  log(`  ✗ telegram: ${(e as Error).message}`);
}
await new Promise((r) => setTimeout(r, 1500));

type Shot = { name: string; go: (p: Page) => Promise<void>; phone?: boolean; clip?: "dialog" };
const at = (hash: string) => async (p: Page) => {
  await p.goto(`${core}/#${hash}`);
  await p.getByRole("button", { name: "Inbox" }).first().waitFor();
};
const settings = (label: string) => async (p: Page) => {
  await at("thread=home")(p);
  await p.keyboard.press("ControlOrMeta+Comma");
  const dialog = p.getByRole("dialog", { name: "Settings" });
  if (!(await dialog.isVisible().catch(() => false)))
    await p.getByRole("button", { name: "Settings", exact: true }).first().click();
  await dialog.getByText(label, { exact: true }).first().click();
};
const project = (tab: string) => at(`project=${ids.acme}&tab=${tab}`);
const resources = (seg: string) => async (p: Page) => {
  await at("view=resources")(p);
  await p
    .getByRole("radio", { name: new RegExp(`^${seg}`) })
    .first()
    .click();
};

const SHOTS: Shot[] = [
  { name: "home-hero", go: at("thread=home") },
  { name: "inbox", go: at(`thread=${ids.luciaChat}`) },
  { name: "chat", go: project(`chats&thread=${ids.luciaChat}`) },
  { name: "chat-panel", go: at(`thread=${ids.luciaChat}&panel=files`) },
  { name: "chat-terminal", go: at(`thread=${ids.luciaChat}&panel=terminal`) },
  {
    name: "slash",
    go: async (p) => {
      await at("thread=home")(p);
      await p.getByRole("textbox").last().click();
      await p.keyboard.type("/");
    },
  },
  {
    name: "command-palette",
    go: async (p) => {
      await at("thread=home")(p);
      await p.keyboard.press("ControlOrMeta+K");
      await p.keyboard.type("launch");
    },
  },
  { name: "project", go: project("overview") },
  { name: "team", go: project("team") },
  {
    name: "org",
    go: async (p) => {
      await project("team")(p);
      await p
        .getByRole("tab", { name: /^Areas and roles/ })
        .first()
        .click();
    },
  },
  {
    name: "agent-panel",
    go: async (p) => {
      await at(`thread=${ids.luciaChat}`)(p);
      await p
        .getByRole("button", { name: /^View Lucía/ })
        .first()
        .click();
    },
  },
  { name: "tasks", go: at("view=tasks") },
  {
    name: "task-drawer",
    go: async (p) => {
      await at("view=tasks")(p);
      await p.getByText("Redesign the checkout page").first().click();
    },
  },
  {
    name: "commitments",
    go: async (p) => {
      await at("view=tasks")(p);
      await p
        .getByRole("radio", { name: /^Commitments/ })
        .first()
        .click();
    },
  },
  { name: "routines", go: project("routines") },
  { name: "memory", go: project("memory") },
  { name: "files", go: project("files") },
  { name: "resources-skills", go: resources("Skills") },
  { name: "resources-mcp", go: resources("MCP") },
  { name: "resources-integrations", go: resources("Integrations") },
  { name: "resources-variables", go: resources("Variables") },
  { name: "resources-extensions", go: resources("Extensions") },
  { name: "settings-engines", go: settings("Engines and models") },
  { name: "settings-router", go: settings("Router") },
  { name: "settings-memory", go: settings("Memory") },
  { name: "settings-profile", go: settings("Profile") },
  { name: "settings-interruptions", go: settings("Interruptions") },
  { name: "settings-channels", go: settings("Channels") },
  { name: "settings-devices", go: settings("Devices") },
  { name: "settings-desktop", go: settings("Desktop") },
  { name: "settings-appearance", go: settings("Appearance") },
  { name: "settings-agents", go: settings("Agents") },
  { name: "settings-tokens", go: settings("API tokens") },
  { name: "channel", go: at("channel=telegram") },
  { name: "external-sessions", go: at("engine=claude") },
  {
    name: "app-widget",
    go: async (p) => {
      await at("thread=home")(p);
      await p.getByRole("complementary").getByRole("button", { name: "BTC market panel" }).first().click();
    },
  },
  {
    name: "phone-pair",
    go: async (p) => {
      await at("thread=home")(p);
      await p.getByRole("button", { name: "More options" }).first().click();
      await p.getByText("Open on your phone", { exact: true }).first().click();
    },
  },
  {
    name: "wizard-welcome",
    go: async (p) => {
      await at("thread=home")(p);
      await p
        .getByRole("button", { name: /^Account/ })
        .first()
        .click();
      await p.getByText("First-run setup", { exact: true }).first().click();
    },
  },
  {
    name: "wizard-agent",
    go: async (p) => {
      await at("thread=home")(p);
      await p
        .getByRole("button", { name: /^Account/ })
        .first()
        .click();
      await p.getByText("First-run setup", { exact: true }).first().click();
      await p.getByText("Start from scratch", { exact: true }).first().click();
    },
  },
  { name: "phone-home", go: at("thread=home"), phone: true },
];

const browser = await chromium.launch({ executablePath: process.env.SHOTS_CHROMIUM || undefined });
const prefs = async (p: Page, mode: "light" | "dark") =>
  p.addInitScript((mode) => {
    try {
      localStorage.setItem("apx.mode", mode);
      localStorage.setItem("apx.prefs", JSON.stringify({ language: "en", look: "minimal", displayName: "Alex" }));
      localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true }));
    } catch {}
  }, mode);
// The demo lives in a temp folder; it shows the way a reader's own one would, under ~ (kept so across re-renders).
const tidyPaths = (p: Page) =>
  p.addInitScript(
    (homes) => {
      const tidy = (t: string) => homes.reduce((s, h) => s.split(h).join("~"), t);
      const fix = (root: Node) => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode())
          if (n.nodeValue && homes.some((h) => n.nodeValue?.includes(h))) n.nodeValue = tidy(n.nodeValue);
      };
      new MutationObserver((records) => {
        for (const r of records) fix(r.type === "characterData" ? (r.target.parentNode ?? r.target) : r.target);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    },
    [fs.realpathSync(fakeHome), fakeHome],
  );
fs.mkdirSync(out, { recursive: true });
let failed = 0;
// Every shot in both themes: the docs show the one that matches the page (name.webp light, name-dark.webp dark).
for (const theme of ["light", "dark"] as const)
  for (const shot of SHOTS) {
    if (only.size && !only.has(shot.name)) continue;
    const file = theme === "dark" ? `${shot.name}-dark` : shot.name;
    const ctx = await browser.newContext({
      viewport: shot.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      locale: "en-US",
      timezoneId: "America/New_York",
      isMobile: Boolean(shot.phone),
      hasTouch: Boolean(shot.phone),
    });
    const page = await ctx.newPage();
    await prefs(page, theme);
    await tidyPaths(page);
    try {
      await shot.go(page);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(900);
      await page.mouse.move(0, 0);
      const png = await page.screenshot({ animations: "disabled", caret: "hide" });
      await sharp(png)
        .webp({ quality: 82 })
        .toFile(path.join(out, `${file}.webp`));
      log(`✓ ${file}`);
    } catch (e) {
      failed++;
      log(`✗ ${file}: ${(e as Error).message.split("\n")[0]}`);
      if (process.env.SHOTS_KEEP)
        fs.writeFileSync(
          path.join(dir, `${file}.aria.yml`),
          await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => ""),
        );
    }
    await ctx.close();
  }
await browser.close();
log(failed ? `${failed} shot(s) failed; core log in ${dir}/core.log (SHOTS_KEEP=1 keeps it)` : "all shots taken");
await stop(failed ? 1 : 0);
