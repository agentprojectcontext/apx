import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { _electron, chromium, type Page } from "@playwright/test";
import { waitFor } from "../apps/core/src/testkit/platform.ts";
import type { ApxClient } from "../packages/protocol/src/client.ts";
import { appVersion } from "./upgrade-fixture.ts";

type Options = {
  bundle: string;
  home: string;
  url: string;
  feed: string;
  target: string;
  previous: string;
  client: ApxClient;
  thread: string;
};

async function desktopProfile(o: Options) {
  const data = path.join(o.home, "desktop-data");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "connection.json"), JSON.stringify({ mode: "url", url: o.url }));
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const bin = path.join(o.home, "bin");
  fs.mkdirSync(bin);
  // OS open still launches the actual replacement; only its profile and diagnostic port are fixed to this fixture.
  fs.writeFileSync(
    path.join(bin, "open"),
    `#!/bin/sh
exec /usr/bin/open -n --env "HOME=$HOME" --env "APX_HOME=$APX_HOME" --env "APX_DESKTOP_DATA=$APX_DESKTOP_DATA" --env "APX_URL=$APX_URL" --env "APX_RELEASES=$APX_RELEASES" --env "APX_QUIT_CONFIRM=off" --env "APX_TELEMETRY=off" --env "APX_RUNTIME_SKILLS=off" "$@" --args "--remote-debugging-port=$APX_UPGRADE_CDP_PORT"
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: o.home,
    APX_HOME: path.join(o.home, "unused-local-core"),
    APX_DESKTOP_DATA: data,
    APX_URL: o.url,
    APX_RELEASES: o.feed,
    APX_QUIT_CONFIRM: "off",
    APX_TELEMETRY: "off",
    APX_RUNTIME_SKILLS: "off",
    APX_UPGRADE_CDP_PORT: String(port),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  return { data, port, env };
}

async function stageAndRestart(panel: Page, app: Awaited<ReturnType<typeof _electron.launch>>, home: string) {
  await panel.locator(".shell").waitFor({ timeout: 30_000 });
  await panel.screenshot({ path: path.join(home, "desktop-before.png") });
  await panel.evaluate(() =>
    (window as unknown as { apxDesktop: { updateStatus(check: boolean): Promise<unknown> } }).apxDesktop.updateStatus(
      true,
    ),
  );
  const result = await panel.evaluate(() =>
    (
      window as unknown as { apxDesktop: { installUpdate(): Promise<{ ok: boolean; ready: boolean; error?: string }> } }
    ).apxDesktop.installUpdate(),
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ready, true);
  const closed = app.waitForEvent("close", { timeout: 30_000 });
  await panel
    .evaluate(() => {
      void (window as unknown as { apxDesktop: { restartToUpdate(): Promise<unknown> } }).apxDesktop.restartToUpdate();
    })
    .catch(() => {});
  await closed;
}

async function checkClient(page: Page, o: Options) {
  await page.locator(".shell").waitFor({ timeout: 30_000 });
  const version = await page.evaluate(
    async () =>
      (
        await (
          window as unknown as { apxDesktop: { updateStatus(): Promise<{ current: string }> } }
        ).apxDesktop.updateStatus()
      ).current,
  );
  assert.equal(version, o.target);
  const preserved = (await page.evaluate(async (thread) => {
    const response = await fetch("/rpc/threads.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.json();
  }, o.thread)) as { ok: boolean; result?: { thread: { title: string } } };
  assert.equal(preserved.ok, true);
  assert.equal(preserved.result?.thread.title, "Upgrade preserved chat");
  await page.screenshot({ path: path.join(o.home, "desktop-after.png") });
}

async function stopRelaunched(pid: number) {
  const exited = () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  try {
    await waitFor(exited, "relaunched app exit", { ms: 10_000 });
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    await waitFor(exited, "forced relaunched app exit", { ms: 10_000 });
  }
}

/** Exercises the actual native bridge, verified package swap, OS relaunch and remote-client operation. */
export async function upgradeDesktop(o: Options) {
  const { data, port, env } = await desktopProfile(o);
  const before = await o.client.call("system.health", {});
  await o.client.call("setup.finish", {});
  assert.equal(appVersion(o.bundle), o.previous);
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let relaunchedPid: number | undefined;
  try {
    app = await _electron.launch({ executablePath: path.join(o.bundle, "Contents/MacOS/APX"), env, timeout: 60_000 });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), o.previous);
    const panel = await waitFor(() => app?.windows().find((p) => p.url().startsWith(o.url)), "previous remote panel", {
      ms: 30_000,
    });
    const previousPid = app.process().pid;
    await stageAndRestart(panel, app, o.home);
    app = undefined;
    await waitFor(
      () => {
        try {
          return appVersion(o.bundle) === o.target;
        } catch {
          return false;
        }
      },
      "native app replacement",
      { ms: 90_000 },
    );
    relaunchedPid = await waitFor(
      () => {
        try {
          const pid = Number(/-(\d+)$/.exec(fs.readlinkSync(path.join(data, "SingletonLock")))?.[1]);
          if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && pid !== previousPid) {
            process.kill(pid, 0);
            return pid;
          }
        } catch {}
        return undefined;
      },
      "isolated relaunched app PID",
      { ms: 30_000 },
    );
    await waitFor(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok;
        } catch {
          return false;
        }
      },
      "OS-relaunched client debugger",
      { ms: 30_000 },
    );
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30_000 });
    const updated = await waitFor(
      () =>
        browser
          ?.contexts()
          .flatMap((c) => c.pages())
          .find((p) => p.url().startsWith(o.url)),
      "candidate remote reconnection",
      { ms: 30_000 },
    );
    await checkClient(updated, o);
    const after = await o.client.call("system.health", {});
    assert.equal(after.home_id, before.home_id);
    assert.equal(after.started_at, before.started_at, "remote client must not restart an already-current server");
    assert.equal(fs.existsSync(path.join(o.home, "unused-local-core", "apx.db")), false);
    return {
      native_update: true,
      os_relaunch: true,
      reconnected: true,
      basic_operation: true,
      data_preserved: true,
      external_core_unchanged: true,
    };
  } finally {
    try {
      if (app) await app.close();
    } finally {
      try {
        if (browser) await browser.close();
      } finally {
        if (relaunchedPid) await stopRelaunched(relaunchedPid);
      }
    }
  }
}
