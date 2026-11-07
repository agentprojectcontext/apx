import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type BrowserContext, chromium, expect, type FrameLocator, type Page, type Worker } from "@playwright/test";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { CORE_ENV_FILE, serializeCoreEnv } from "../../packages/protocol/src/core-env.ts";
import { testConfig } from "../core/src/config.ts";
import { say, scriptedLlm } from "../core/src/engine/testkit.ts";
import { which } from "../core/src/harness/detect.ts";
import { installChromeHost } from "../core/src/nodes/chrome-host.ts";
import { createCore } from "../core/src/server.ts";
import { tempDir } from "../core/src/testkit/platform.ts";
import { extensionBundle } from "./bundle.ts";
import { EXTENSION_ID } from "./identity.ts";

export const LONG_MODEL = "northwind-assistant-with-a-long-name-and-important-version-2026-11";

export async function capture(page: Page, frame: FrameLocator, language: string, state: string) {
  const destination = process.env.APX_CHROME_EVIDENCE;
  if (!destination) return;
  await fs.mkdir(destination, { recursive: true });
  for (const width of [400, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator("iframe")).toHaveJSProperty("clientWidth", width);
    await frame
      .locator("body")
      .evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(destination, `${language}-${state}-${width}.png`) });
  }
  await page.setViewportSize({ width: 400, height: 800 });
  await expect(frame.locator("body")).toHaveJSProperty("clientWidth", 400);
  await frame
    .locator("body")
    .evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function withPanel(
  language: "en" | "es",
  empty: boolean,
  run: (lab: {
    core: Awaited<ReturnType<typeof createCore>>;
    client: ApxClient;
    page: Page;
    frame: FrameLocator;
    worker: Worker;
    context: BrowserContext;
    token: string;
    llm: ReturnType<typeof scriptedLlm>;
    stopCore(): Promise<void>;
    restartCore(): Promise<void>;
  }) => Promise<void>,
  /** `script`: the model's answers. `nativeHost`: `apx chrome-host` registered in this profile, pointed at this core. */
  opts: { script?: Parameters<typeof scriptedLlm>[0]; nativeHost?: boolean } = {},
) {
  assert.equal(await which("claude"), undefined, "Run the extension tests through the isolated pnpm runner");
  assert.equal(await which("codex"), undefined, "Run the extension tests through the isolated pnpm runner");
  const webDist = path.resolve(import.meta.dirname, "../web/dist");
  await fs.access(path.join(webDist, "index.html")).catch(() => assert.fail("Build the panel first: pnpm build:web"));
  await using home = tempDir("apx-chrome-panel-core-");
  await using profile = tempDir("apx-chrome-panel-profile-");
  await using extension = tempDir("apx-chrome-panel-bundle-");
  const llm = scriptedLlm(opts.script ?? (() => say("The isolated chat reached APX.")));
  const token = randomBytes(32).toString("hex");
  const startCore = (port = 0) =>
    createCore(
      testConfig({
        home: home.path,
        port,
        token,
        webDist,
        agentName: "APX",
        providers: empty
          ? []
          : [
              {
                id: "custom",
                transport: "openai-chat",
                base_url: "http://127.0.0.1:9",
                key: "none",
                models: ["sample-one", LONG_MODEL],
              },
            ],
        ollamaUrl: "http://127.0.0.1:9",
        imessage: false,
      }),
      {
        quiet: true,
        llm,
        imessage: null,
        sleptSince: () => false,
        keepAwake: () => ({ kill: () => true, once: () => undefined }),
      },
    );
  let core = await startCore();
  const port = Number(new URL(core.url).port);
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let closed = false;
  const stopCore = async () => {
    if (!closed) {
      await core.close();
      closed = true;
    }
  };
  const restartCore = async () => {
    if (closed) {
      core = await startCore(port);
      closed = false;
    }
  };
  try {
    const client = new ApxClient({ url: core.url, token });
    if (!empty) await client.call("models.set_config", { default: { model: "custom/sample-one", router: false } });
    for (const [name, content] of Object.entries(extensionBundle(Number(new URL(core.url).port)))) {
      const file = path.join(extension.path, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    }
    if (opts.nativeHost) {
      // The host reads the core's token where `apx` does; Chrome looks for hosts in its profile folder.
      await fs.writeFile(path.join(home.path, CORE_ENV_FILE), serializeCoreEnv({ APX_TOKEN: token }), { mode: 0o600 });
      const written = installChromeHost({
        home: home.path,
        port,
        runner: {
          exe: process.execPath,
          main: path.resolve(import.meta.dirname, "../terminal/src/main.ts"),
          electron: false,
        },
        browsers: [profile.path],
      });
      assert.equal(written.length, 1);
    }
    context = await chromium.launchPersistentContext(profile.path, {
      channel: "chromium",
      headless: true,
      viewport: { width: 400, height: 800 },
      colorScheme: "light",
      locale: language === "es" ? "es-AR" : "en-US",
      args: [
        `--lang=${language}`,
        `--disable-extensions-except=${extension.path}`,
        `--load-extension=${extension.path}`,
      ],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    assert.equal(new URL(worker.url()).hostname, EXTENSION_ID);
    assert.equal(await worker.evaluate("chrome.runtime.id"), EXTENSION_ID);
    const page = await context.newPage();
    await page.goto(new URL("panel.html", worker.url()).href);
    const frame = page.frameLocator('iframe[title="APX"]');
    await run({ core, client, page, frame, worker, context, token, llm, stopCore, restartCore });
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    if (context && process.env.APX_CHROME_EVIDENCE) {
      await fs.mkdir(process.env.APX_CHROME_EVIDENCE, { recursive: true });
      const lastPage = context.pages().at(-1);
      if (lastPage) {
        await lastPage.screenshot({ path: path.join(process.env.APX_CHROME_EVIDENCE, `${language}-failure.png`) });
        for (const frame of lastPage.frames()) {
          const text = await frame
            .locator("body")
            .innerText({ timeout: 2000 })
            .catch(() => "Frame unavailable");
          process.stderr.write(`${text}\n`);
        }
      }
    }
    throw error;
  } finally {
    await context?.close();
    await stopCore();
  }
}
