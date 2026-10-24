import assert from "node:assert/strict";
import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { TabInfo } from "@apx/protocol";
import { chromium } from "@playwright/test";
import { removeDir } from "../testkit/platform.ts";
import { createHeadlessBrowser } from "./headless-browser.ts";

const chrome = chromium.executablePath();
const PAGES: Record<string, string> = {
  "/": `<html><head><title>Acme home</title></head><body><h1>Acme</h1><a href="/prices">Prices</a>
    <form action="/search"><input name="q" aria-label="Search"><input type="password" aria-label="Password"></form></body></html>`,
  "/prices": `<html><head><title>Prices</title></head><body><p>From 10 a month.</p></body></html>`,
  "/to-apx": "",
};
let srv: http.Server;
let base = "";
let apxPort = "";
let dir = "";
let chromeStderr = "";
let browser: ReturnType<typeof createHeadlessBrowser>;
const seen: TabInfo[][] = [];

before(async () => {
  assert.ok(fs.existsSync(chrome), "Install the browser first: pnpm exec playwright install chromium");
  srv = http.createServer((req, res) => {
    if (req.url === "/to-apx") return res.writeHead(302, { location: `http://127.0.0.1:${apxPort}/rpc` }).end();
    const page = PAGES[req.url?.split("?")[0] ?? ""];
    if (page === undefined) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Stands in for APX's own port: a tab must never reach it, not even through a redirect.
  const apx = http.createServer((_q, r) => r.end("APX"));
  await new Promise<void>((r) => apx.listen(0, "127.0.0.1", r));
  apxPort = String((apx.address() as AddressInfo).port);
  apx.unref();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-headless-"));
  browser = createHeadlessBrowser({
    dir,
    chrome,
    // Chromium cannot start its sandbox as root in a disposable test container.
    // Keep this exception at the test's process boundary; production keeps its sandbox.
    spawn: ((command: string, args: readonly string[], options: SpawnOptions) => {
      const child = spawn(command, [...args, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], options);
      child.stderr?.on("data", (data) => {
        chromeStderr = `${chromeStderr}${data}`.slice(-4000);
      });
      return child;
    }) as typeof spawn,
    blockedPorts: () => new Set([apxPort]),
    onChange: (t) => seen.push(t),
  });
});
after(() => {
  browser?.close();
  srv.closeAllConnections();
  srv.close();
  // Chrome may still hold its profile while it exits; Windows keeps it locked until its last helper is gone, and a
  // temp folder left behind there is not a failure of the browser.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 });
  } catch (err) {
    if (process.platform !== "win32") throw err;
  }
});

test("CDP input and output pipe errors reject work and stop Chrome without an unhandled error", async () => {
  for (const stream of ["input", "output"] as const) {
    const input = new PassThrough();
    const output = new PassThrough();
    let killed = false;
    const child = Object.assign(new EventEmitter(), {
      stdio: [null, null, null, output, input],
      kill: () => {
        killed = true;
        return true;
      },
    }) as unknown as ChildProcess;
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-headless-pipe-"));
    const isolated = createHeadlessBrowser({
      dir: isolatedDir,
      chrome: process.execPath,
      spawn: (() => child) as never,
      blockedPorts: () => new Set(),
      onChange: () => {},
    });
    try {
      const opening = isolated.handle("browser.open", { url: "https://example.com", by: "roby" });
      (stream === "input" ? input : output).emit("error", new Error("ECONNRESET"));
      await assert.rejects(opening, /ECONNRESET/);
      assert.equal(isolated.running(), false);
      assert.equal(killed, true);
      assert.deepEqual(isolated.list(), []);
    } finally {
      isolated.close();
      input.destroy();
      output.destroy();
      await removeDir(isolatedDir);
    }
  }
});

test("with no desktop app the core drives its own headless Chrome: open, read, click, type; never a password", async (t) => {
  assert.ok(browser.available());
  const tab = (await browser.handle("browser.open", { url: `${base}/`, by: "roby" }).catch((error) => {
    t.diagnostic(`Browser executable: ${chrome}`);
    t.diagnostic(chromeStderr || "No browser stderr");
    throw error;
  })) as TabInfo;
  assert.equal(tab.title, "Acme home");
  assert.deepEqual(tab.control.kind, "agent");
  const snap = (await browser.handle("browser.snapshot", { tab: tab.tab })) as { tree: string };
  assert.match(snap.tree, /^<untrusted_web source=/, "page content is marked as outside data");
  const link = /link "Prices" \[(e\d+)\]/.exec(snap.tree)?.[1];
  const search = /textbox "Search" \[(e\d+)\]/.exec(snap.tree)?.[1];
  const password = /textbox "Password" \[(e\d+)\]/.exec(snap.tree)?.[1];
  assert.ok(link && search && password, snap.tree);
  await browser.handle("browser.type", { tab: tab.tab, ref: search, text: "plans", by: "roby" });
  await assert.rejects(
    browser.handle("browser.type", { tab: tab.tab, ref: password, text: "x", by: "roby" }),
    /password/,
  );
  const clicked = (await browser.handle("browser.click", { tab: tab.tab, ref: link, by: "roby" })) as { url: string };
  assert.equal(clicked.url, `${base}/prices`);
  const text = (await browser.handle("browser.text", { tab: tab.tab })) as { text: string };
  assert.match(text.text, /From 10 a month/);
  await assert.rejects(
    browser.handle("browser.handoff", { tab: tab.tab, reason: "log in", by: "roby" }),
    /nobody can take over/,
  );
  await assert.rejects(
    browser.handle("browser.navigate", { tab: tab.tab, url: `http://127.0.0.1:${apxPort}/`, by: "roby" }),
    /APX itself/,
  );
  await browser.handle("browser.navigate", { tab: tab.tab, url: `${base}/to-apx`, by: "roby" });
  const after = (await browser.handle("browser.text", { tab: tab.tab })) as { text: string };
  assert.doesNotMatch(after.text, /^APX$/, "a redirect to APX is blocked too");
  assert.ok(seen.length > 0, "tab changes reach the panel");
  await browser.handle("browser.close", { tab: tab.tab });
  assert.deepEqual(browser.list(), []);
});
