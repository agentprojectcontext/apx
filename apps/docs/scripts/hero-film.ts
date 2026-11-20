#!/usr/bin/env node
// Records the home's hero video: the whole panel of the demo office (shots.ts's own core, SHOTS_SERVE) in one take,
// a cursor going through a few things one after another. One take per theme, saved as public/media/hero/panel-<theme>.mp4
// and the chapter times as src/data/hero-film.json (the dots under the video). Needs `pnpm build:web` at the repo root.
//   node --no-warnings scripts/hero-film.ts [light|dark]…   (none: both; `data` alone only rewrites the JSON)
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Browser, chromium, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { ALL_SLIDES } from "../../../apps/web/src/shell/welcomeFilm.ts";

const here = import.meta.dirname;
const media = path.resolve(here, "../public/media/hero");
const port = Number(process.env.HERO_PORT ?? 7492);
const core = `http://127.0.0.1:${port}`;
const W = 1440;
const H = 900;
const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where each chapter starts, in seconds: both takes keep to it, so one set of dots fits either video. */
const CHAPTERS = [
  { id: "ask", at: 0 },
  { id: "group", at: 10 },
  { id: "routine", at: 27 },
  { id: "flow", at: 37 },
  { id: "marketplace", at: 52 },
  { id: "share", at: 61 },
] as const;
const LENGTH = 74;

// A widget to share: the same sample the app's welcome film uses (no real figures).
const ORDERS = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:15px/1.4 Inter,system-ui,sans-serif;background:#faf8f4;color:#1f1d1a;padding:22px}
h1{font-size:19px;margin:0 0 2px}p{margin:0 0 16px;color:#76716a;font-size:13px}
.k{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.k div{background:#fff;border-radius:12px;padding:12px;box-shadow:0 1px 2px #0001}.k b{display:block;font-size:22px}
.k span{font-size:12px;color:#76716a}.bars{display:flex;align-items:flex-end;gap:8px;height:180px;background:#fff;border-radius:12px;padding:12px}
.bars i{flex:1;background:#5aa469;border-radius:6px 6px 2px 2px}.d{display:flex;gap:8px;padding:6px 12px 0;font-size:11px;color:#8b867f}.d span{flex:1;text-align:center}
@media (prefers-color-scheme:dark){body{background:#1c1b19;color:#f2efe9}.k div,.bars{background:#262522;box-shadow:none}}
</style></head><body><h1>Weekly orders</h1><p>Acme Store · Monday to Sunday</p>
<div class="k"><div><b>128</b><span>Orders</span></div><div><b>$12,480</b><span>Billed</span></div><div><b>96%</b><span>On time</span></div></div>
<div class="bars"><i style="height:45%"></i><i style="height:62%"></i><i style="height:58%"></i><i style="height:80%"></i><i style="height:92%"></i><i style="height:70%"></i><i style="height:35%"></i></div>
<div class="d"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></body></html>`;
const BUNDLE = {
  format: "apx-artifact@1",
  manifest: { name: "weekly-orders", title: "Weekly orders", kind: "widget", version: 1 },
  html: ORDERS,
};
// The cloud side of "Anyone with the link" is answered here: a sample account and code, nothing published.
const CODE = "k7m2p9qa";
const PUBLIC_URL = `https://artifact.apxagent.app/${CODE}`;
const PROFILE = { id: "9bspfhsq", name: "Alex", photo: null, handle: "alex" };

/** The demo office's core, from shots.ts: resolves once it is seeded and serving. */
function startCore(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--no-warnings", path.join(here, "shots.ts")], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, SHOTS_SERVE: "1", SHOTS_PORT: String(port), SHOTS_LLM_PACE_MS: "70" },
  });
  return new Promise((resolve, reject) => {
    child.stdout?.on("data", (b: Buffer) => {
      if (String(b).includes("demo core on")) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`demo core exited (${code})`)));
  });
}

let seq = 0;
async function rpc<T = Record<string, unknown>>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch(`${core}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `hero-${Date.now()}-${seq++}` },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; error?: { message: string } };
  if (!body.ok) throw new Error(`${method}: ${body.error?.message}`);
  return body.result as T;
}

/** A pointer drawn in the page (screen captures leave the real one out), kept above dialogs through the top layer. */
function cursorScript() {
  // Only the panel's own page: a widget's frame would draw a second pointer.
  if (window !== window.top) return;
  const make = () => {
    const c = document.createElement("div");
    c.id = "film-cursor";
    c.setAttribute("popover", "manual");
    c.innerHTML =
      '<span class="film-ring"></span><svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l0 19 5-4.5 3.4 7.6 3.3-1.5-3.3-7.4 6.8-.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const st = document.createElement("style");
    st.textContent = `#film-cursor{position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none;width:22px;height:26px;transform:translate(-60px,-60px);filter:drop-shadow(0 2px 3px rgb(0 0 0/.3))}
#film-cursor svg{position:absolute;left:-2px;top:-2px}
#film-cursor .film-ring{position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;background:rgb(16 185 129/.35);transform:scale(0);opacity:0}
#film-cursor.down .film-ring{animation:film-ring .45s ease-out}
@keyframes film-ring{0%{transform:scale(.2);opacity:1}100%{transform:scale(1.4);opacity:0}}`;
    document.head.append(st);
    document.documentElement.append(c);
    const raise = () => {
      try {
        c.hidePopover();
        c.showPopover();
      } catch {}
    };
    raise();
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true);
    addEventListener(
      "mousedown",
      () => {
        c.classList.remove("down");
        void c.offsetWidth;
        c.classList.add("down");
      },
      true,
    );
    // A dialog or menu that opens goes on top of the top layer: put the pointer back above it.
    new MutationObserver(() => {
      if (document.querySelector(":modal, :popover-open:not(#film-cursor)")) raise();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", make);
  else make();
}

/** The demo lives in a temp folder; on screen it reads the way a reader's own would, under ~. */
function tidyPathsScript() {
  const temp = /\/(?:private\/)?(?:var\/folders|tmp)\/\S*?apx-shots-[^/\s]+\/home/g;
  const fix = (root: Node) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode())
      if (n.nodeValue?.includes("apx-shots-")) n.nodeValue = n.nodeValue.replace(temp, "~");
  };
  new MutationObserver((records) => {
    for (const r of records) fix(r.type === "characterData" ? (r.target.parentNode ?? r.target) : r.target);
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

/** The take: a cursor that glides, clicks and types, each chapter starting on its CHAPTERS second. */
function director(page: Page, t0: number) {
  let cx = W * 0.62;
  let cy = H * 0.7;
  let rnd = 7;
  const random = () => {
    rnd = (rnd * 16807) % 2147483647;
    return rnd / 2147483647;
  };
  const until = async (s: number) => {
    const wait = t0 + s * 1000 - Date.now();
    if (wait < -300) log(`  ! ${(-wait / 1000).toFixed(1)}s late for ${s}s`);
    else log(`  ${(wait / 1000).toFixed(1)}s to spare before ${s}s`);
    if (wait > 0) await sleep(wait);
  };
  const glide = async (x: number, y: number, ms = 650) => {
    const n = Math.max(6, Math.round(ms / 18));
    const [x0, y0] = [cx, cy];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      await sleep(ms / n - 2);
    }
    [cx, cy] = [x, y];
  };
  const to = async (target: Locator, ms = 650, dx = 0.5, dy = 0.5) => {
    await target.waitFor({ timeout: 15_000 }).catch(async (e) => {
      if (process.env.HERO_KEEP) {
        await page.screenshot({ path: path.join(os.tmpdir(), "apx-hero-fail.png") });
        fs.writeFileSync(path.join(os.tmpdir(), "apx-hero-fail.yml"), await page.locator("body").ariaSnapshot());
      }
      throw e;
    });
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    if (!b) throw new Error("no box");
    await glide(b.x + b.width * dx, b.y + b.height * dy, ms);
  };
  const click = async (target: Locator, ms = 650) => {
    await to(target, ms);
    await sleep(140);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await sleep(220);
  };
  const type = async (text: string) => {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(28 + random() * 55);
    }
  };
  /** A route the panel opens itself (a link elsewhere on screen), without a page load. */
  const go = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
  return { until, glide, to, click, type, go };
}

async function take(browser: Browser, theme: "light" | "dark", frames: string) {
  const child = await startCore();
  try {
    const acme = (await rpc<{ projects: Array<{ id: string; name: string }> }>("projects.list")).projects.find(
      (p) => p.name === "Acme Store",
    )?.id;
    const made = await rpc<{ id?: string; surface?: { id: string } }>("surfaces.import", { bundle: BUNDLE });
    const widget = made.id ?? made.surface?.id;
    if (!acme || !widget) throw new Error("demo office incomplete");

    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      colorScheme: theme,
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();
    await page.addInitScript(
      ({ mode, seen }) => {
        try {
          localStorage.setItem("apx.mode", mode);
          localStorage.setItem("apx.prefs", JSON.stringify({ language: "en", look: "minimal", displayName: "Alex" }));
          localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcomeSeen: seen }));
        } catch {}
      },
      { mode: theme, seen: ALL_SLIDES },
    );
    await page.addInitScript(cursorScript);
    await page.addInitScript(tidyPathsScript);
    const st = { published: false };
    const ok = (result: unknown) => ({ json: { ok: true, result } });
    const draft = () => ({
      draft: "3f1c2a9e-5b7d-4c11-9a2e-7d4b8c6e1f20",
      code: CODE,
      url: PUBLIC_URL,
      action: "publish",
      title: "Weekly orders",
      bytes: JSON.stringify(BUNDLE).length,
      state_keys: [],
      expires_at: new Date(Date.now() + 9e5).toISOString(),
    });
    await page.route("**/rpc/account.get", (r) =>
      r.fulfill(ok({ available: true, profile: PROFILE, pending: false, unreadable: false })),
    );
    await page.route("**/rpc/surfaces.public_list", (r) =>
      r.fulfill(
        ok(
          st.published
            ? {
                items: [{ code: CODE, surface: widget, url: PUBLIC_URL, title: "Weekly orders", bytes: 4096 }],
                count: 1,
                bytes: 4096,
              }
            : { items: [], count: 0, bytes: 0 },
        ),
      ),
    );
    await page.route("**/rpc/surfaces.public_prepare", (r) => r.fulfill(ok(draft())));
    await page.route("**/rpc/surfaces.public_preview", (r) =>
      r.fulfill(
        ok({ ...draft(), bundle: BUNDLE, account: PROFILE, review_token: "5d0f8a2c-1e3b-4a6d-8c9f-2b7e4d1a6c30" }),
      ),
    );
    await page.route("**/rpc/surfaces.public_commit", (r) => {
      st.published = true;
      return r.fulfill(ok({ code: CODE, url: PUBLIC_URL, action: "publish" }));
    });

    await page.goto(`${core}/#thread=home`);
    await page.getByRole("button", { name: "Inbox" }).first().waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);

    // Every frame the page paints, with its time; the encoder holds each until the next.
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    const cdp = await ctx.newCDPSession(page);
    const shots: Array<[string, number]> = [];
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
      const file = path.join(frames, `${String(shots.length).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      shots.push([file, f.metadata.timestamp]);
      void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H });
    const t0 = Date.now();
    const d = director(page, t0);
    const nav = page.getByRole("complementary", { name: "Navigation" });
    const side = (name: string) => nav.getByRole("button", { name: new RegExp(`^${name}`) }).first();

    // 1 · Ask an agent: Nova plans the launch and the answer writes itself.
    await d.until(0.6);
    const box = page.getByRole("textbox").last();
    await d.click(box, 900);
    await d.type("Plan the Q4 launch with the team, four weeks.");
    await sleep(250);
    await page.keyboard.press("Enter");
    await d.glide(W * 0.86, H * 0.55, 900);

    // 2 · A group chat: three agents in one chat, the one it is meant for answers.
    await d.until(CHAPTERS[1].at);
    await d.go(`project=${acme}&tab=chats`);
    await sleep(700);
    await d.click(page.getByRole("combobox", { name: "New chat" }).first());
    await d.click(page.getByRole("button", { name: "New group" }), 450);
    const dialog = page.getByRole("dialog", { name: "New group" });
    for (const n of [/^Desk/, /^Lucía/, /^Tomás/])
      await d.click(dialog.getByRole("checkbox", { name: n }).first(), 380);
    await d.click(dialog.getByRole("textbox", { name: "Name" }), 450);
    await d.type("Launch crew");
    await d.click(dialog.getByRole("button", { name: "Create group" }), 500);
    await sleep(600);
    await d.click(page.getByRole("textbox").last(), 600);
    await d.type("Tomás, can you check the checkout?");
    await page.keyboard.press("Enter");
    await d.glide(W * 0.8, H * 0.45, 900);

    // 3 · A routine: run Daily summary now.
    await d.until(CHAPTERS[2].at);
    await d.click(side("Routines"), 800);
    const row = page.getByRole("button", { name: /Daily summary/ }).first();
    await d.to(row, 600, 0.3);
    await sleep(300);
    // Rows are not grouped for assistive tech: Daily summary's Run now is the third.
    await d.click(page.getByRole("button", { name: "Run now" }).nth(2), 500);
    await sleep(1200);
    await d.click(row, 500);

    // 4 · A Flow: the webhook template, then one more step drawn in.
    await d.until(CHAPTERS[3].at);
    await d.click(side("Flows"), 800);
    await d.click(page.getByRole("button", { name: /^From a webhook/ }), 700);
    await sleep(900);
    await d.click(page.getByRole("button", { name: "Add Notify" }), 800);
    await sleep(1100);
    // The new step opens its settings; close them and fit the whole flow back on screen.
    await page.keyboard.press("Escape");
    await d.click(page.getByRole("button", { name: "Fit to screen" }), 900);
    await sleep(1600);
    await d.click(page.getByRole("button", { name: "Exit the editor" }), 900);
    // The draft is not kept: the editor asks, and the take leaves it.
    await d.click(page.getByRole("button", { name: "Leave", exact: true }), 500);

    // 5 · The Marketplace: what agents can use, then one to connect.
    await d.until(CHAPTERS[4].at);
    await d.click(side("Marketplace"), 800);
    // Rows move while the catalog loads: aim only once it has.
    await page
      .getByText(/^Reading APX.s catalog/)
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
    await sleep(700);
    await d.click(page.getByText("Google Calendar", { exact: true }).first(), 800);
    await sleep(1500);

    // 6 · Share a widget with a link.
    await d.until(CHAPTERS[5].at);
    await d.go(`app=${widget}`);
    await sleep(1000);
    await d.click(page.getByRole("button", { name: /^Share/ }).first(), 800);
    await d.click(page.getByRole("combobox", { name: "Who can see it" }), 500);
    await d.click(page.getByRole("option", { name: /^Public/ }).first(), 450);
    await sleep(500);
    const review = page.getByRole("dialog", { name: "Share public" });
    await d.click(review.getByRole("button", { name: "Share public" }), 1100);
    await sleep(1800);

    // Back where it started, so the loop closes on the same screen.
    await d.until(LENGTH - 2.2);
    const done = page.getByRole("dialog", { name: "It’s public now" }).getByRole("button", { name: "Done" });
    if (await done.isVisible().catch(() => false)) await d.click(done, 500);
    await d.click(side("Inbox"), 700);
    await d.go("thread=home");
    await d.glide(W * 0.62, H * 0.7, 900);
    await d.until(LENGTH);
    await cdp.send("Page.stopScreencast");
    await ctx.close();
    return shots;
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}

/** Frames held for their own time, at 30 fps, as a small H.264 file that starts playing before it has all loaded. */
function encode(shots: Array<[string, number]>, out: string) {
  const list = path.join(path.dirname(shots[0][0]), "list.txt");
  const start = shots[0][1];
  const rows = shots.map(([file, t], i) => {
    const next = shots[i + 1]?.[1] ?? start + LENGTH;
    return `file '${file}'\nduration ${Math.max(0.001, next - t).toFixed(4)}`;
  });
  fs.writeFileSync(list, `${rows.join("\n")}\nfile '${shots.at(-1)?.[0]}'\n`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // biome-ignore format: one ffmpeg flag per pair reads better
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=30,trim=duration=${LENGTH},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "24",
    "-tune", "stillimage", "-profile:v", "high", "-movflags", "+faststart", "-an", out], { stdio: "inherit" });
}

/** The chapters, and the poster (shots.ts's home-hero) as a tiny picture the card shows blurred until it loads. */
async function writeData() {
  const posters: Record<string, string> = {};
  for (const [theme, file] of [
    ["light", "home-hero"],
    ["dark", "home-hero-dark"],
  ]) {
    const tiny = await sharp(path.resolve(here, `../src/assets/shots/${file}.webp`))
      .resize(32)
      .webp({ quality: 50 })
      .toBuffer();
    posters[theme] = `data:image/webp;base64,${tiny.toString("base64")}`;
  }
  const out = path.resolve(here, "../src/data/hero-film.json");
  fs.writeFileSync(out, `${JSON.stringify({ length: LENGTH, chapters: CHAPTERS, posters }, null, 2)}\n`);
}

// `data` alone rewrites src/data/hero-film.json (after a new home-hero poster) without recording.
const args = process.argv.slice(2);
const asked = args.filter((a) => a !== "data") as Array<"light" | "dark">;
const themes = asked.length || args.includes("data") ? asked : (["light", "dark"] as const);
const browser = themes.length
  ? await chromium.launch({ executablePath: process.env.SHOTS_CHROMIUM || undefined })
  : null;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "apx-hero-"));
try {
  for (const theme of browser ? themes : []) {
    log(`recording ${theme}…`);
    const shots = await take(browser, theme, path.join(scratch, theme));
    const out = path.join(media, `panel-${theme}.mp4`);
    encode(shots, out);
    log(
      `✓ ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${shots.length} frames)`,
    );
  }
  await writeData();
} finally {
  await browser?.close();
  if (!process.env.HERO_KEEP) fs.rmSync(scratch, { recursive: true, force: true });
  else log(`frames kept in ${scratch}`);
}
