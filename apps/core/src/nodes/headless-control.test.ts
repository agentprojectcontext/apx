// The owner takes over a tab of the core's own Chrome from a panel: they watch it live, sign in with their own hand,
// give it back, and the agent goes on in the same signed-in tab. Real Chromium, as the server runs it.
import assert from "node:assert/strict";
import { type SpawnOptions, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { TabInfo } from "@apx/protocol";
import { chromium } from "@playwright/test";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createHeadlessBrowser } from "./headless-browser.ts";

const chrome = chromium.executablePath();
// Fixed places, so a point on the frame is a known field; fractions are of the visible page the frame reports.
const LOGIN = `<html><head><title>Northwind sign-in</title><style>
  body{margin:0} input,button{position:absolute;left:100px;width:300px;height:40px;font-size:20px}
  #user{top:100px} #pass{top:200px} #go{top:300px}</style></head><body>
  <form onsubmit="event.preventDefault(); document.cookie='session=' + user.value; location.href='/home'">
  <input id="user" aria-label="Username"><input id="pass" type="password" aria-label="Password">
  <button id="go">Sign in</button></form></body></html>`;
const HOME = `<html><head><title>Northwind</title></head><body><p id="who"></p>
  <script>who.textContent = 'Signed in as ' + (document.cookie.match(/session=([^;]*)/) || [])[1]</script></body></html>`;
let page = { width: 1280, height: 900 };
const at = (px: number, py: number) => ({ x: px / page.width, y: py / page.height });

let srv: http.Server;
let base = "";
const home = tempDir("apx-headless-control-");
let browser: ReturnType<typeof createHeadlessBrowser>;

before(async () => {
  assert.ok(fs.existsSync(chrome), "Install the browser first: pnpm exec playwright install chromium");
  srv = http.createServer((req, res) => {
    const page = req.url === "/home" ? HOME : req.url === "/" ? LOGIN : undefined;
    if (page === undefined) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  browser = createHeadlessBrowser({
    dir: home.path,
    chrome,
    // Chromium cannot start its sandbox as root in a disposable test container; production keeps its sandbox.
    spawn: ((command: string, args: readonly string[], options: SpawnOptions) =>
      spawn(command, [...args, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], options)) as typeof spawn,
    blockedPorts: () => new Set(),
    onChange: () => {},
  });
});
after(async () => {
  browser?.close();
  srv.closeAllConnections();
  srv.close();
  await home.remove().catch(() => {});
});

const owner = (tab: string, events: unknown[]) => browser.handle("browser.input", { tab, events });
const click = (tab: string, p: { x: number; y: number }) =>
  owner(tab, [
    { type: "mouse", action: "down", ...p },
    { type: "mouse", action: "up", ...p },
  ]);
const frame = (tab: string, after = 0) =>
  browser.handle("browser.frame", { tab, after, max_width: 800, wait_ms: 3000 }) as Promise<{
    seq: number;
    data?: string;
    width: number;
    height: number;
  }>;

test("the owner takes a server tab, signs in by hand, gives it back and the agent goes on signed in", async () => {
  const tab = ((await browser.handle("browser.open", { url: `${base}/`, by: "superagent" })) as TabInfo).tab;
  // As the panel does: it asks again until the first picture comes.
  const first = await waitFor(
    async () => {
      const f = await frame(tab);
      return f.data ? f : undefined;
    },
    "a first picture of the page",
    { ms: 20_000 },
  );
  assert.equal(first.width, 1280);
  page = first;

  // Only a tab the owner holds takes their hand.
  await assert.rejects(click(tab, at(250, 120)), /take control/);
  await browser.handle("browser.control", { tab, mode: "user" });
  // While they hold it, the agent neither acts in it nor reads it.
  await assert.rejects(
    browser.handle("browser.click", { tab, ref: "e1", by: "superagent" }),
    (e: { code?: string }) => e.code === "paused_by_user",
  );
  await assert.rejects(
    browser.handle("browser.snapshot", { tab }),
    (e: { code?: string }) => e.code === "paused_by_user",
  );

  await click(tab, at(250, 120));
  await owner(tab, [{ type: "text", text: "ada" }]);
  await click(tab, at(250, 220));
  await owner(tab, [{ type: "text", text: "s3cret" }]);
  await owner(tab, [
    { type: "key", action: "down", key: "Enter", code: "Enter" },
    { type: "key", action: "up", key: "Enter", code: "Enter" },
  ]);
  await waitFor(
    async () => ((await browser.handle("browser.tabs", {})) as { tabs: TabInfo[] }).tabs[0]?.url.endsWith("/home"),
    "the sign-in to go through",
  );
  // The page changed: a newer frame shows it.
  const later = await frame(tab, first.seq);
  assert.ok(later.seq > first.seq && later.data);

  await browser.handle("browser.control", { tab, mode: "idle" });
  const text = (await browser.handle("browser.text", { tab })) as { text: string };
  assert.match(text.text, /Signed in as ada/);
  await browser.handle("browser.navigate", { tab, url: `${base}/home`, by: "superagent" });
  assert.match(((await browser.handle("browser.text", { tab })) as { text: string }).text, /Signed in as ada/);
  await browser.handle("browser.close", { tab });
});

test("an agent's handoff waits for the owner, who works the tab and says done; then the agent has it again", async () => {
  const tab = ((await browser.handle("browser.open", { url: `${base}/`, by: "superagent" })) as TabInfo).tab;
  const handed = browser.handle("browser.handoff", { tab, reason: "sign in", by: "superagent", timeout_s: 30 });
  await waitFor(async () => {
    const t = ((await browser.handle("browser.tabs", {})) as { tabs: TabInfo[] }).tabs.find((x) => x.tab === tab);
    return t?.control.kind === "handoff";
  }, "the handoff");
  // During a handoff the owner's hand works without taking control first.
  await click(tab, at(250, 120));
  await owner(tab, [{ type: "text", text: "grace" }]);
  await browser.handle("browser.control", { tab, mode: "done" });
  const out = (await handed) as { resolved: boolean };
  assert.equal(out.resolved, true);
  const after = ((await browser.handle("browser.tabs", {})) as { tabs: TabInfo[] }).tabs.find((x) => x.tab === tab);
  assert.equal(after?.control.kind, "agent");
  await browser.handle("browser.close", { tab });
});
