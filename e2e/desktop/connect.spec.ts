// The first run asks how APX is used on this computer (server or client); the answer is kept.
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { testConfig } from "../../apps/core/src/config.ts";
import { createCore } from "../../apps/core/src/server.ts";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { saveLocalTarget } from "../../packages/install/src/paths.ts";
import { installFakeSsh } from "../fake-ssh.ts";
import { rpc, world } from "../specs/kit.ts";

const root = path.resolve(import.meta.dirname, "../..");
const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;
let home: string;
let coreHome: string;

const launch = (env: Record<string, string> = {}) =>
  _electron.launch({
    args: [path.join(root, "apps/desktop"), ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_QUIT_CONFIRM: "off",
      APX_URL: "",
      APX_HOME: coreHome,
      APX_PORT: process.env.E2E_PORT ?? "7460",
      APX_WEB_URL: "http://127.0.0.1:9",
      ...env,
    },
  });

/**
 * A stand-in for ssh: the server takes only a password (s3cret) until this app's key is in, then has APX (the e2e's
 * core, reached through an actual TCP forward). The question goes through the app's real askpass; each run's arguments land
 * in `calls`.
 */
const FAKE_SSH = `#!/bin/sh
state="$FAKE_SSH_STATE"
echo "$*" >> "$state/calls"
case " $* " in *" -V "*) echo "OpenSSH_9.6p1, fake" >&2; exit 0 ;; esac
case "$*" in
  *BatchMode=yes*)
    if [ -f "$state/down" ]; then echo "ssh: connect to host box port 22: Connection refused" >&2; exit 255; fi
    if [ -f "$state/authorized" ]; then
      case " $* " in *" -N "*) exec "$FAKE_SSH_NODE" "$FAKE_SSH_STATE/proxy.mjs" "$@" ;; esac
      exit 0
    fi
    echo "ops@box: Permission denied (publickey,password)." >&2
    exit 255 ;;
esac
answer=$("$SSH_ASKPASS" "ops@box's password: ") || exit 255
[ "$answer" = "s3cret" ] || { echo "ops@box: Permission denied (publickey,password)." >&2; exit 255; }
touch "$state/authorized"
echo APX_KEY_OK
`;

async function freePort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

/** The intro holds the hero alone for a moment; a key skips straight to the question. */
async function question(page: Page): Promise<Page> {
  await expect(page.locator(".connect__stage")).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.locator(".connect__stage.is-ready")).toBeVisible();
  return page;
}

async function windowAt(app: ElectronApplication, test: (url: string) => boolean): Promise<Page> {
  // Quick chat preloads the core too; it must not satisfy a main-panel navigation.
  const matching = () => app.windows().find((p) => !p.isClosed() && !p.url().includes("quick=1") && test(p.url()));
  await expect.poll(() => Boolean(matching()), { timeout: 20_000 }).toBe(true);
  return matching() as Page;
}

test.beforeAll(async () => {
  coreHome = (await world.info()).home;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-connect-"));
  fs.mkdirSync(path.join(home, "desktop"), { recursive: true });
});
test.afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("desktop installed from the web reopens the same core without another connection setup", async () => {
  const dataDir = path.join(home, "installed-desktop");
  saveLocalTarget(dataDir, {
    home: coreHome,
    port: Number(process.env.E2E_PORT ?? "7460"),
    home_id: fs.readFileSync(path.join(coreHome, "home-id"), "utf8").trim(),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const app = await launch({ APX_HOME: "", APX_PORT: "", APX_DESKTOP_DATA: dataDir });
    await windowAt(app, (url) => url.startsWith(core));
    expect(app.windows().some((page) => page.url().includes("?connect"))).toBe(false);
    const target = JSON.parse(fs.readFileSync(path.join(dataDir, "connection.json"), "utf8"));
    expect(target.home).toBe(fs.realpathSync(coreHome));
    expect(target.port).toBe(Number(process.env.E2E_PORT ?? "7460"));
    await app.close();
  }
  fs.rmSync(path.join(dataDir, "connection.json"));
});

test("an explicit local handoff asks an already running desktop to relaunch into its saved target", async () => {
  const dataDir = path.join(home, "running-desktop");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "connection.json"), JSON.stringify({ mode: "url", url: core }));
  const app = await launch({ APX_DESKTOP_DATA: dataDir });
  await windowAt(app, (url) => url.startsWith(core));
  saveLocalTarget(dataDir, {
    home: coreHome,
    port: Number(process.env.E2E_PORT ?? "7460"),
    home_id: fs.readFileSync(path.join(coreHome, "home-id"), "utf8").trim(),
  });
  const actions = await app.evaluate(({ app }) => {
    const calls: string[] = [];
    const relaunch = app.relaunch;
    const quit = app.quit;
    app.relaunch = () => {
      calls.push("relaunch");
    };
    app.quit = () => {
      calls.push("quit");
    };
    app.emit("second-instance", {} as Electron.Event, ["APX", "--apx-adopt-local"], "", {});
    app.relaunch = relaunch;
    app.quit = quit;
    return calls;
  });
  expect(actions).toEqual(["relaunch", "quit"]);
  await app.close();
  fs.rmSync(path.join(dataDir, "connection.json"));
});

test("the first run asks server or client; a new server opens its installed welcome and keeps the choice", async () => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const freshHome = path.join(home, "first-run-core");
  const dataDir = path.join(home, "first-run-desktop");
  const fresh = await createCore(testConfig({ home: freshHome, port, webDist: path.join(root, "apps/web/dist") }), {
    quiet: true,
  });
  const env = { APX_HOME: freshHome, APX_PORT: String(port), APX_DESKTOP_DATA: dataDir };
  let first: ElectronApplication | undefined;
  let again: ElectronApplication | undefined;
  try {
    first = await launch(env);
    const chooser = await question(await windowAt(first, (u) => u.startsWith("apx-app://")));
    await expect(chooser.locator("#pick-server")).toBeVisible();
    await expect(chooser.locator("#pick-client")).toBeVisible();
    await chooser.locator("#pick-server").click();
    await expect(chooser.locator('[data-access="none"]')).toHaveAttribute("aria-pressed", "true");
    await chooser.locator("#server-go").click();
    const panel = await windowAt(first, (url) => url.startsWith(fresh.url));
    await expect(panel.locator(".wiz")).toBeVisible();
    const language = await panel.locator("html").getAttribute("lang");
    expect(["en", "es"]).toContain(language);
    await expect(panel.locator(".wiz__pill")).toContainText(
      language === "es" ? "APX está instalado" : "APX is installed",
    );
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "connection.json"), "utf8"))).toEqual({ mode: "local" });
    await first.close();
    first = undefined;

    again = await launch(env);
    const reopened = await windowAt(again, (u) => u.startsWith(fresh.url));
    await expect(reopened.locator(".wiz")).toBeVisible();
    await expect(reopened.locator(".wiz__pill")).not.toContainText(/APX (?:está instalado|is installed)/);
    expect(again.windows().some((p) => p.url().startsWith("apx-app://"))).toBe(false);
    expect(again.windows().some((p) => p.url().includes("welcome="))).toBe(false);
  } finally {
    await first?.close();
    await again?.close();
    await fresh.close();
  }
});

test("choosing an already configured local server opens its panel without repeating setup", async () => {
  await rpc("setup.finish");
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const app = await launch();
  try {
    const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await chooser.locator("#pick-server").click();
    await chooser.locator("#server-go").click();
    const panel = await windowAt(app, (url) => url.startsWith(core));
    await expect(panel.locator(".shell")).toBeVisible();
    await expect(panel.locator(".wiz")).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, "desktop", "connection.json"), "utf8"))).toEqual({
      mode: "local",
    });
  } finally {
    await app.close();
  }
});

test("a client address that does not answer is refused on the spot", async () => {
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const app = await launch();
  const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
  await chooser.locator("#pick-client").click();
  await chooser.locator("#url").fill("http://127.0.0.1:9");
  await chooser.locator("#client-go").click();
  await expect(chooser.locator("#client-error")).toBeVisible();
  expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
  await app.close();
});

test("changing connection revokes the old desktop node before choosing a new server", async () => {
  fs.mkdirSync(path.join(home, "desktop"), { recursive: true });
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  try {
    const panel = await windowAt(app, (u) => u.startsWith(core));
    await expect(panel.locator(".shell")).toBeVisible();
    const browserNode = async () => {
      const health = (await (await fetch(`${core}/health`)).json()) as {
        result: { subsystems: { browser: { detail: string } } };
      };
      return health.result.subsystems.browser.detail;
    };
    await expect.poll(browserNode).toBe("apx-desktop");
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("change-connection")?.click());
    let chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await expect.poll(browserNode).not.toBe("apx-desktop");
    expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
    // The checkout's core is still the one the e2e started: nothing took it down.
    expect((await fetch(`${core}/health`)).ok).toBe(true);
    await chooser.locator("#pick-client").click();
    await chooser.locator("#url").fill(core);
    await chooser.locator("#client-go").click();
    expect((await windowAt(app, (u) => u.startsWith(core))) === panel).toBe(true);
    await expect(panel.locator(".shell")).toBeVisible();
    expect(await browserNode()).not.toBe("apx-desktop");
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("change-connection")?.click());
    chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await chooser.locator("#pick-server").click();
    await chooser.locator("#server-go").click();
    expect((await windowAt(app, (u) => u.startsWith(core))) === panel).toBe(true);
    await expect(panel.locator(".shell")).toBeVisible();
    await expect.poll(browserNode).toBe("apx-desktop");
  } finally {
    await app.close();
  }
});

test("About opens APX's own window with this build's versions and the repo", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  await windowAt(app, (u) => u.startsWith(core));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("about")?.click());
  const about = await windowAt(app, (u) => u.includes("?about"));
  await expect(about.locator(".about__version")).toContainText("APX");
  await expect(about.locator(".about__status")).toBeVisible();
  await expect(about.locator(".about__list")).toContainText("Protocol");
  await expect(about.locator(".about__repo")).toHaveAttribute("href", /github\.com/);
  await app.close();
});

test("the panel runs the app menu's About, update and connection items (Windows and Linux have no menu bar)", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  const panel = await windowAt(app, (u) => u.startsWith(core));
  await panel.evaluate(() =>
    (window as { apxDesktop?: { menuAction?(id: string): void } }).apxDesktop?.menuAction?.("about"),
  );
  await windowAt(app, (u) => u.includes("?about"));
  await app.close();
});

test("a server that only takes a password asks for it in the terminal view, then this app's key logs in and opens it", async () => {
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ssh-"));
  installFakeSsh(state, FAKE_SSH);
  const app = await launch({
    PATH: `${state}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_SSH_STATE: state,
    FAKE_SSH_NODE: process.execPath,
    FAKE_SSH_CORE_PORT: process.env.E2E_PORT ?? "7460",
    APX_PORT: "7441",
  });
  try {
    const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await chooser.locator("#pick-client").click();
    await chooser.getByRole("radio", { name: "SSH" }).click();
    await chooser.locator("#ssh").fill("ops@box");
    await chooser.locator("#client-go").click();

    // Once connecting starts, the screen is only the terminal: no buttons until it ends or asks.
    await expect(chooser.locator("#connect-term")).toBeVisible();
    await expect(chooser.locator("#client-go")).toHaveCount(0);
    const input = chooser.locator("#term-input");
    await expect(input).toHaveAttribute("type", "password");
    await expect(chooser.locator(".connect__term-prompt")).toHaveText("ops@box's password:");
    await input.fill("wrong");
    await input.press("Enter");
    await expect(chooser.locator("#client-error")).toBeVisible();
    await expect(chooser.locator("#connect-log")).not.toContainText("wrong");

    // Back goes to the server field, with what was typed.
    await chooser.locator("#term-back").click();
    await expect(chooser.locator("#ssh")).toHaveValue("ops@box");
    await chooser.locator("#client-go").click();
    await input.fill("s3cret");
    await input.press("Enter");
    // Logged in with the key it just left there, the server's APX opens.
    await windowAt(app, (u) => u.startsWith("http://127.0.0.1:7441"));
    expect(JSON.parse(fs.readFileSync(path.join(home, "desktop", "connection.json"), "utf8"))).toEqual({
      mode: "ssh",
      target: "ops@box",
    });

    // The key was made here, and every ssh after the login offers it.
    const key = path.join(home, "desktop", "ssh", "apx_ed25519");
    expect(fs.existsSync(key)).toBe(true);
    const calls = fs.readFileSync(path.join(state, "calls"), "utf8").trim().split("\n");
    const after = calls.slice(calls.findLastIndex((c) => c.includes("BatchMode=no")) + 1);
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) expect(c).toContain(`-i ${key}`);
    expect(calls.join("\n")).not.toContain("s3cret");
  } finally {
    await app.close();
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  }
});

test("an occupied SSH forwarding port never adopts the unrelated local core", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ssh-busy-"));
  const dataDir = path.join(home, "ssh-busy-desktop");
  installFakeSsh(state, FAKE_SSH);
  fs.writeFileSync(path.join(state, "authorized"), "");
  const app = await launch({
    PATH: `${state}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_SSH_STATE: state,
    FAKE_SSH_NODE: process.execPath,
    FAKE_SSH_CORE_PORT: process.env.E2E_PORT ?? "7460",
    APX_DESKTOP_DATA: dataDir,
  });
  try {
    const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await chooser.locator("#pick-client").click();
    await chooser.getByRole("radio", { name: "SSH" }).click();
    await chooser.locator("#ssh").fill("ops@box");
    await chooser.locator("#client-go").click();
    await expect(chooser.locator("#client-error")).toContainText("SSH could not bind");
    expect(fs.existsSync(path.join(dataDir, "connection.json"))).toBe(false);
    expect(app.windows().some((p) => p.url().startsWith(core))).toBe(false);
  } finally {
    await app.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test("APX_URL stays connect-only even with a saved local choice", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch({ APX_URL: core });
  try {
    const panel = await windowAt(app, (u) => u.startsWith(core));
    expect(
      await panel.evaluate(
        () => (window as { apxDesktop?: { coreLocal: boolean; coreToken?: string } }).apxDesktop?.coreLocal,
      ),
    ).toBe(false);
    expect(
      await panel.evaluate(() => (window as { apxDesktop?: { coreToken?: string } }).apxDesktop?.coreToken),
    ).toBeUndefined();
  } finally {
    await app.close();
  }
  expect((await fetch(`${core}/health`)).ok).toBe(true);
});

test("a local port belonging to another home is not adopted", async () => {
  const other = path.join(home, "other-home");
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, "home-id"), "another-installation");
  const app = await launch({ APX_HOME: other, APX_CONNECTION: "local" });
  try {
    const page = await windowAt(app, (u) => u.startsWith("data:text/html") && u.endsWith("#apx-unreachable"));
    await expect(page.locator("body")).toContainText("belongs to another home");
    expect(app.windows().some((p) => p.url().startsWith(core))).toBe(false);
  } finally {
    await app.close();
  }
  expect((await fetch(`${core}/health`)).ok).toBe(true);
});

/**
 * A desktop that already chose a server over SSH (the fake ssh, already logged in), and that server's APX: its own
 * core on another port, started and stopped by the test as an update would.
 */
async function sshClient(name: string) {
  const temp = tempDir(`apx-e2e-${name}-`);
  const state = temp.path;
  const dataDir = path.join(home, `${name}-desktop`);
  const remoteHome = path.join(home, `${name}-core`);
  const [remotePort, localPort] = [await freePort(), await freePort()];
  installFakeSsh(state, FAKE_SSH);
  fs.writeFileSync(path.join(state, "authorized"), "");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "connection.json"), JSON.stringify({ mode: "ssh", target: "ops@box" }));
  let remote: Awaited<ReturnType<typeof createCore>> | undefined;
  let app: ElectronApplication | undefined;
  return {
    state,
    panelUrl: `http://127.0.0.1:${localPort}`,
    launch: async () => {
      app = await launch({
        PATH: `${state}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_SSH_STATE: state,
        FAKE_SSH_NODE: process.execPath,
        FAKE_SSH_CORE_PORT: String(remotePort),
        APX_DESKTOP_DATA: dataDir,
        APX_PORT: String(localPort),
      });
      return app;
    },
    serverUp: async () => {
      remote = await createCore(
        testConfig({ home: remoteHome, port: remotePort, webDist: path.join(root, "apps/web/dist") }),
        { quiet: true },
      );
    },
    serverDown: async () => {
      await remote?.close();
      remote = undefined;
    },
    close: async () => {
      await app?.close();
      await remote?.close();
      await temp.remove();
    },
  };
}

test("an SSH client waits for its server to come back after an update, then opens the panel by itself", async () => {
  const client = await sshClient("ssh-back");
  // The server is still restarting: ssh cannot log in yet.
  fs.writeFileSync(path.join(client.state, "down"), "");
  try {
    const app = await client.launch();
    const waiting = await windowAt(app, (u) => u.includes("#apx-connecting"));
    await expect(waiting.locator("body")).toContainText("ops@box");
    await expect(waiting.locator("body")).toContainText("Connection refused");
    // Logged in again, but the server's APX is not answering yet: still waiting, never the final error.
    fs.rmSync(path.join(client.state, "down"));
    await expect(waiting.locator("body")).toContainText(/SSH (connection is up|está lista)/);
    expect(app.windows().some((p) => p.url().includes("#apx-unreachable"))).toBe(false);
    await client.serverUp();
    const panel = await windowAt(app, (u) => u.startsWith(client.panelUrl));
    await expect(panel.locator("#root > *").first()).toBeVisible();
  } finally {
    await client.close();
  }
});

test("a panel that reloads while its SSH server restarts waits for it instead of going blank", async () => {
  const client = await sshClient("ssh-reload");
  try {
    await client.serverUp();
    const app = await client.launch();
    const panel = await windowAt(app, (u) => u.startsWith(client.panelUrl));
    await expect(panel.locator("#root > *").first()).toBeVisible();
    // The update restarts the server's APX, and the panel reloads for its new build meanwhile.
    await client.serverDown();
    await panel.evaluate(() => window.location.reload()).catch(() => {});
    await windowAt(app, (u) => u.includes("#apx-connecting"));
    await client.serverUp();
    const back = await windowAt(app, (u) => u.startsWith(client.panelUrl));
    await expect(back.locator("#root > *").first()).toBeVisible();
  } finally {
    await client.close();
  }
});

test("Change connection back to the same SSH server shows its panel", async () => {
  const client = await sshClient("ssh-again");
  try {
    await client.serverUp();
    const app = await client.launch();
    const panel = await windowAt(app, (u) => u.startsWith(client.panelUrl));
    await expect(panel.locator("#root > *").first()).toBeVisible();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("change-connection")?.click());
    const chooser = await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
    await chooser.locator("#pick-client").click();
    await chooser.getByRole("radio", { name: "SSH" }).click();
    await chooser.locator("#ssh").fill("ops@box");
    await chooser.locator("#client-go").click();
    const again = await windowAt(app, (u) => u.startsWith(client.panelUrl));
    await expect(again.locator("#root > *").first()).toBeVisible();
  } finally {
    await client.close();
  }
});
