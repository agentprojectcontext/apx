// A core that asks for a token (reachable from other devices): the panel shows "Pair this device" instead of the app,
// a wrong code says so, the owner's one-time code pairs this browser, and a token that stops working is dropped. Its
// own core, apart from the shared sandbox: a token there would lock every other spec out.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.E2E_PAIR_PORT ?? 7466);
const core = `http://127.0.0.1:${port}`;
const TOKEN = "e2e-core-token-for-pairing";

let proc: ChildProcess | undefined;
let dir = "";

base.beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-pair-"));
  const home = path.join(dir, "home");
  proc = spawn(process.execPath, ["--no-warnings", path.join(root, "apps/core/src/main.ts")], {
    cwd: root,
    stdio: "ignore",
    env: {
      // Nothing of this machine's: no agent CLIs, no v1, no Keychain, no updates, no Messages.
      PATH: ["/usr/bin", "/bin"].join(path.delimiter),
      HOME: dir,
      APX_HOME: home,
      APX_PORT: String(port),
      APX_TOKEN: TOKEN,
      APX_SECRETS: "file",
      APX_UPDATES: "off",
      APX_IMESSAGE: "off",
      APX_V1_HOME: path.join(dir, "v1"),
      APX_V1_URL: "http://127.0.0.1:9",
      CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
      CODEX_HOME: path.join(dir, "codex"),
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${core}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the token-protected core did not start");
});

base.afterAll(() => {
  proc?.kill("SIGTERM");
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** The owner, with the core's token (as `apx2 pair` on the server would be). */
async function pairCode(): Promise<string> {
  const res = await fetch(`${core}/rpc/devices.pair_start`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "idempotency-key": `pair-start-${Date.now()}`,
    },
    body: "{}",
  });
  const body = (await res.json()) as { ok: boolean; result: { code: string } };
  expect(body.ok).toBe(true);
  return body.result.code;
}

// The core's refusals (403 for no token, 401 for a wrong code) are what this spec is about; anything else on the
// console still fails it.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !/40[13]|favicon|net::ERR_ABORTED/i.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
    await use(page);
    expect(errors, "console errors").toEqual([]);
  },
});

test("panel pairs with a code when the core asks for a token", async ({ page }) => {
  await page.goto(core);
  await expect(page.getByText("Vinculá este")).toBeVisible();
  const input = page.getByRole("textbox", { name: "Código de vinculación" });

  await input.fill("WRONG234");
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ese código es incorrecto o venció. Pedí uno nuevo.");

  await input.fill(await pairCode());
  await page.getByRole("button", { name: "Vincular" }).click();
  // Paired: the page reloads with its own key and the app opens (a fresh core starts on its setup).
  await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();
  await expect(page.getByText("Vinculá este")).toBeHidden();
  const token = await page.evaluate(() => localStorage.getItem("apx.token"));
  expect(token).toMatch(/^apxd_/);

  // The owner sees this browser in their list, named after its system.
  const list = await fetch(`${core}/rpc/devices.list`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "idempotency-key": "list" },
    body: "{}",
  });
  const { result } = (await list.json()) as { result: { devices: Array<{ name: string; platform: string }> } };
  expect(result.devices).toEqual([expect.objectContaining({ name: expect.stringMatching(/^Navegador \(/) })]);
});

test("a stored token the core no longer takes is dropped and the gate shows again", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("apx.token", "apxd_revoked-or-never-valid");
    }
  });
  await page.goto(core);
  await expect(page.getByText("Vinculá este")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("apx.token"))).toBeNull();
});
