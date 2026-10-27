import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { DesktopUpdate } from "./updater.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apx-updater-test-"));
const opened: string[] = [];
const shown: string[] = [];
let relaunches = 0;
const native = {
  app: {
    isPackaged: true,
    getVersion: () => "2.0.0",
    getPath: () => directory,
    relaunch: () => {
      relaunches++;
    },
  },
  shell: {
    openPath: async (file: string) => {
      opened.push(file);
      return "No handler";
    },
    showItemInFolder: (file: string) => shown.push(file),
  },
};
const key = Symbol.for("apx.test.updater");
Object.assign(globalThis, { [key]: native });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.updater")]; export const app = n.app; export const shell = n.shell;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createDesktopUpdater, pickUpdate } = await import("./updater.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const originalImage = process.env.APPIMAGE;
const originalFeed = process.env.APX_RELEASES;
Object.defineProperty(process, "platform", { value: "linux" });
delete process.env.APPIMAGE;
process.env.APX_RELEASES = "http://updates.test";
after(() => {
  if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  if (originalImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = originalImage;
  if (originalFeed === undefined) delete process.env.APX_RELEASES;
  else process.env.APX_RELEASES = originalFeed;
  fs.rmSync(directory, { recursive: true, force: true });
});
const name = `APX-2.1.0-linux-${process.arch}.AppImage`;
const asset = (filename: string) => ({ name: filename, browser_download_url: `http://updates.test/${filename}` });
const release = { tag_name: "v2.1.0", body: "- Better updates", assets: [asset(name), asset(`${name}.sha256`)] };
const bytes = "Test installer bytes";
const checksum = createHash("sha256").update(bytes).digest("hex");
function harness() {
  const states: DesktopUpdate[] = [];
  let quits = 0;
  const updater = createDesktopUpdater({ changed: (status) => states.push(status), quit: () => quits++ });
  return { updater, states, quits: () => quits };
}

test("update selection falls back to the newest compatible release and excludes unsupported targets", () => {
  const answer = pickUpdate([{ tag_name: "v2.2.0", assets: [] }, release], "2.0.0", "linux", process.arch);
  assert.equal(answer?.release.version, "2.1.0");
  assert.equal(answer?.asset.name, name);
  assert.deepEqual(answer?.notes, ["Better updates"]);
  assert.equal(pickUpdate([release], "2.1.0", "linux", process.arch), undefined);
  assert.equal(pickUpdate([release], "2.0.0", "freebsd", process.arch), undefined);
});

test("disabled updates stay offline and cannot claim an available installer", async (t) => {
  native.app.isPackaged = false;
  const h = harness();
  native.app.isPackaged = true;
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected request");
  });
  assert.equal(h.updater.enabled, false);
  assert.equal((await h.updater.check()).latest, undefined);
  assert.deepEqual(await h.updater.install(), { ok: false, error: "No newer APX for this computer." });
  h.updater.start(() => assert.fail("Disabled updater started"));
  h.updater.stop();
  h.updater.restart();
  h.updater.quitting();
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(h.quits(), 0);
});

test("feed failures publish an error and a later successful check clears it", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const h = harness();
  const failed = await h.updater.check();
  assert.match(failed.error ?? "", /503/);
  assert.ok(failed.checked_at);
  fetch.mock.mockImplementation(async () => Response.json([release]));
  const recovered = await h.updater.check();
  assert.equal(recovered.error, undefined);
  assert.equal(recovered.latest, "2.1.0");
  assert.equal(recovered.install, "drag");
  assert.deepEqual(recovered.notes, ["Better updates"]);
  assert.equal(h.states.length, 2);
});

test("concurrent installs share a verified download and only open the file after checksum validation", async (t) => {
  opened.length = 0;
  shown.length = 0;
  const requests: string[] = [];
  let finish: (() => void) | undefined;
  const download = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/releases?")) return Response.json([release]);
    if (url.endsWith(".sha256")) return new Response(`${checksum}  ${name}`);
    await download;
    return new Response(bytes);
  });
  const h = harness();
  await h.updater.check();
  const first = h.updater.install();
  const duplicate = h.updater.install();
  assert.equal(first, duplicate);
  assert.equal(h.updater.status().downloading, true);
  assert.deepEqual(opened, []);
  assert.ok(finish);
  finish();
  assert.deepEqual(await first, { ok: true, ready: false });
  assert.equal(h.updater.status().downloading, false);
  assert.equal(requests.filter((url) => url.endsWith(".AppImage")).length, 1);
  const file = path.join(directory, name);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  assert.equal(fs.existsSync(`${file}.sha256`), false);
  assert.deepEqual(opened, [file]);
  assert.deepEqual(shown, [file]);
  assert.equal(h.quits(), 0);
  fs.rmSync(file);
});

test("a corrupt download is deleted, never opened and installation can recover on retry", async (t) => {
  opened.length = 0;
  let valid = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([release]);
    if (url.endsWith(".sha256")) return new Response(valid ? checksum : "not a checksum");
    return new Response(bytes);
  });
  const h = harness();
  const failed = await h.updater.install();
  assert.equal(failed.ok, false);
  assert.match("error" in failed ? failed.error : "", /does not match/);
  assert.equal(fs.existsSync(path.join(directory, name)), false);
  assert.equal(h.updater.status().downloading, false);
  assert.deepEqual(opened, []);
  valid = true;
  assert.deepEqual(await h.updater.install(), { ok: true, ready: false });
  assert.deepEqual(opened, [path.join(directory, name)]);
});

test("a remote manual installer stays unopened until activation and uses the exact target", async (t) => {
  opened.length = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([{ ...release, tag_name: "v2.2.0", assets: [] }, release]);
    if (url.endsWith(".sha256")) return new Response(checksum);
    return new Response(bytes);
  });
  const h = harness();
  assert.deepEqual(await h.updater.install("2.1.0", true), { ok: true, ready: true });
  assert.equal(h.updater.status().ready, "2.1.0");
  assert.deepEqual(opened, []);
  h.updater.quitting();
  assert.deepEqual(opened, []);
  h.updater.restart();
  assert.deepEqual(opened, [path.join(directory, name)]);
});

test("AppImage download does not replace the running image until activation and quit is idempotent", async (t) => {
  const image = path.join(directory, "APX.AppImage");
  fs.writeFileSync(image, "Previous installer");
  process.env.APPIMAGE = image;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases?")) return Response.json([release]);
    return new Response(url.endsWith(".sha256") ? checksum : bytes);
  });
  try {
    const h = harness();
    assert.equal((await h.updater.install("2.1.0", true)).ok, true);
    assert.equal(fs.readFileSync(image, "utf8"), "Previous installer");
    h.updater.discard();
    h.updater.quitting();
    assert.equal(fs.readFileSync(image, "utf8"), "Previous installer");
    assert.equal((await h.updater.install("2.1.0", true)).ok, true);
    h.updater.restart();
    assert.equal(fs.readFileSync(image, "utf8"), bytes);
    h.updater.quitting();
    assert.equal(relaunches, 1);
    assert.equal(h.quits(), 1);
  } finally {
    delete process.env.APPIMAGE;
  }
});

test("a release without its checksum cannot be staged", async (t) => {
  opened.length = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json([{ ...release, assets: [asset(name)] }]));
  const result = await harness().updater.install("2.1.0", true);
  assert.equal(result.ok, false);
  assert.match("error" in result ? result.error : "", /no .sha256/);
  assert.deepEqual(opened, []);
});
