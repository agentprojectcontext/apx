// The first run asks how APX is used on this computer (server or client); the answer is kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const core = `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;
let home: string;

const launch = (env: Record<string, string> = {}) =>
  _electron.launch({
    args: [path.join(root, "apps/desktop"), ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_URL: core,
      APX_WEB_URL: "http://127.0.0.1:9",
      ...env,
    },
  });

/**
 * A stand-in for ssh: the server takes only a password (s3cret) until this app's key is in, then has APX (the e2e's
 * core, already on the forwarded port). The question goes through the app's real askpass; each run's arguments land
 * in `calls`.
 */
const FAKE_SSH = `#!/bin/sh
state="$FAKE_SSH_STATE"
echo "$*" >> "$state/calls"
case " $* " in *" -V "*) echo "OpenSSH_9.6p1, fake" >&2; exit 0 ;; esac
case "$*" in
  *BatchMode=yes*)
    if [ -f "$state/authorized" ]; then
      case " $* " in *" -N "*) exec sleep 600 ;; esac
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

/** The intro holds the hero alone for a moment; a key skips straight to the question. */
async function question(page: Page): Promise<Page> {
  await page.keyboard.press("Space");
  await expect(page.locator(".connect__stage.is-ready")).toBeVisible();
  return page;
}

async function windowAt(app: ElectronApplication, test: (url: string) => boolean): Promise<Page> {
  await expect.poll(() => app.windows().some((p) => test(p.url())), { timeout: 20_000 }).toBe(true);
  return app.windows().find((p) => test(p.url())) as Page;
}

test.beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-connect-"));
});
test.afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("the first run asks server or client; server opens this computer's APX and is not asked again", async () => {
  const first = await launch();
  const chooser = await question(await windowAt(first, (u) => u.startsWith("apx-app://")));
  await expect(chooser.locator("#pick-server")).toBeVisible();
  await expect(chooser.locator("#pick-client")).toBeVisible();
  await chooser.locator("#pick-server").click();
  await expect(chooser.locator('[data-access="none"]')).toHaveAttribute("aria-pressed", "true");
  await chooser.locator("#server-go").click();
  // Just installed: the panel's setup opens saying so.
  await windowAt(first, (u) => u.startsWith(core) && u.includes("welcome=installed"));
  expect(JSON.parse(fs.readFileSync(path.join(home, "desktop", "connection.json"), "utf8"))).toEqual({ mode: "local" });
  await first.close();

  const again = await launch();
  await windowAt(again, (u) => u.startsWith(core));
  expect(again.windows().some((p) => p.url().startsWith("apx-app://"))).toBe(false);
  expect(again.windows().some((p) => p.url().includes("welcome="))).toBe(false);
  await again.close();
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

test("change connection goes back to the question in the same window, and the app stays up", async () => {
  fs.writeFileSync(path.join(home, "desktop", "connection.json"), JSON.stringify({ mode: "local" }));
  const app = await launch();
  await windowAt(app, (u) => u.startsWith(core));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("change-connection")?.click());
  await question(await windowAt(app, (u) => u.startsWith("apx-app://")));
  expect(fs.existsSync(path.join(home, "desktop", "connection.json"))).toBe(false);
  // The checkout's core is still the one the e2e started: nothing took it down.
  expect((await fetch(`${core}/health`)).ok).toBe(true);
  await app.close();
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
  test.skip(process.platform === "win32", "the fake ssh is a shell script");
  fs.rmSync(path.join(home, "desktop", "connection.json"), { force: true });
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-ssh-"));
  fs.writeFileSync(path.join(state, "ssh"), FAKE_SSH, { mode: 0o755 });
  const app = await launch({ PATH: `${state}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_SSH_STATE: state });
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
    await windowAt(app, (u) => u.startsWith(core) && u.includes("welcome=installed"));
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
