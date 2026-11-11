// Signing in with a stored variable in a real Chromium tab, driven by the same CdpPage the desktop and headless browsers
// use: the owner picks the site in Variables, the agent fills the field, and the value reaches only the page
// (DECISIONS.md#d-193). Two local sites on their own ports: the login page and another site framed into it.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { BrowserFillSecret } from "../../packages/protocol/src/browser.ts";
import { CdpPage } from "../../packages/protocol/src/cdp.ts";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { expect, open, rpc, test, until, world } from "./kit.ts";

const SITE = 7601;
const OTHER = 7602;
const PASSWORD = "Northwind-e2e-correct-horse";
const USER = "acme-e2e-signer@example.com";

const LOGIN = (frame: boolean) => `<!doctype html><html><head><title>Sign in</title><style>
body{font-family:system-ui;margin:24px} input{font:32px/1.2 monospace;width:640px;padding:8px;color:#000;background:#fff;border:1px solid #888}
label{display:block;margin-top:12px}</style></head><body><h1>Sign in to Acme</h1>
<form><label>Email <input id="user" type="email" autocomplete="username"></label>
<label>Password <input id="pw" type="password"></label>
<button type="button" onclick="pw.type = pw.type === 'password' ? 'text' : 'password'">Show password</button></form>
<label>Search <input id="search" type="text"></label>
${frame ? `<iframe title="Partner" src="http://127.0.0.1:${OTHER}/frame" width="700" height="140"></iframe>` : ""}
</body></html>`;
const FRAME = `<!doctype html><html><body><form><label>Partner password <input type="password"></label></form></body></html>`;
// A page that copies whatever is typed into its password field onto an attribute.
const LEAKY = `<!doctype html><html><body><form><label>Password <input id="pw" type="password"
oninput="document.body.dataset.seen = this.value"></label></form></body></html>`;
// A React controlled form: each field mirrors its own value into its `value` attribute. That is not a copy.
const MIRRORED = `<!doctype html><html><body><form>
<label>Email <input id="user" type="email" oninput="this.setAttribute('value', this.value)"></label>
<label>Password <input id="pw" type="password" oninput="this.setAttribute('value', this.value)"></label>
</form></body></html>`;

function site(port: number, pages: Record<string, string>) {
  const server = http.createServer((req, res) => {
    const page = pages[req.url ?? ""];
    res.writeHead(page ? 200 : 404, { "content-type": "text/html" });
    res.end(page ?? "");
  });
  return new Promise<http.Server>((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

test("an agent signs in with a variable the owner marked, and the value reaches only the page", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const servers = await Promise.all([
    site(SITE, { "/login": LOGIN(true), "/leaky": LEAKY, "/mirrored": MIRRORED }),
    site(OTHER, { "/frame": FRAME, "/login": LOGIN(false) }),
  ]);
  const tab = await context.newPage();
  await tab.setViewportSize({ width: 1000, height: 700 });
  const session = await context.newCDPSession(tab);
  const cdp = new CdpPage((method, params) => session.send(method as never, params as never) as never, {
    selectAllModifiers: process.platform === "darwin" ? 4 : 2,
  });
  await session.send("Page.enable");
  await session.send("DOM.enable");
  await session.send("Accessibility.enable");
  tab.on("framenavigated", (f) => f === tab.mainFrame() && cdp.forget());
  const { core, token, dir, home } = await world.info();
  const node = await new ApxClient({ url: core, token }).connect("node", ["browser"]);
  node.onRequest(async (method, params) => {
    const p = params as Record<string, unknown>;
    if (method === "browser.tabs")
      return {
        tabs: [{ tab: "t1", url: tab.url(), title: "Sign in", profile: "shared", control: { kind: "idle" } }],
      };
    if (method === "browser.hold") return { ok: true };
    if (method === "browser.snapshot") {
      const snap = await cdp.snapshot(Number(p.max_chars ?? 20_000));
      return { url: tab.url(), title: await tab.title(), ...snap };
    }
    if (method === "browser.screenshot") {
      const data = await cdp.screenshot();
      return { mime: "image/jpeg", data, bytes: Buffer.byteLength(data, "base64") };
    }
    if (method === "browser.fill_secret") return cdp.fillSecret(String(p.ref), params as BrowserFillSecret);
    throw new Error(`Unexpected ${method}`);
  });
  try {
    await rpc("setup.finish", {});
    await rpc("secrets.set", { name: "E2E_LOGIN_PASS", value: PASSWORD });
    await rpc("secrets.set", { name: "E2E_LOGIN_USER", value: USER });

    // The owner marks the sites in Variables.
    await open(page);
    await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
    await page.getByRole("radio", { name: /^Variables/ }).click();
    await page.getByRole("button", { name: "Iniciar sesión con E2E_LOGIN_PASS" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Sitios" }).fill(`http://127.0.0.1:${SITE}`);
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(`Inicio de sesión: http://127.0.0.1:${SITE}`)).toBeVisible();
    await page.getByRole("button", { name: "Iniciar sesión con E2E_LOGIN_USER" }).click();
    await dialog.getByRole("radio", { name: "Usuario" }).click();
    await dialog.getByRole("textbox", { name: "Sitios" }).fill(`http://127.0.0.1:${SITE}`);
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await until(async () => {
      const { secrets } = await rpc<{
        secrets: Array<{ name: string; sites: Array<{ origin: string; kind: string }> }>;
      }>("secrets.list", {});
      return secrets.find((s) => s.name === "E2E_LOGIN_USER")?.sites[0]?.kind === "username";
    });

    await tab.goto(`http://127.0.0.1:${SITE}/login`);
    const agent = await rpc<{ id: string }>("agents.create", { slug: "signer", name: "Signer" });
    const thread = (await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: agent.id })).id;
    await open(page, `#thread=${thread}`);
    const composer = page.getByRole("textbox", { name: /Escribile|Message/ });
    // Each request waits for the turn to end: an earlier answer that reads the same must not let the next one in mid-turn.
    const runs = async () => (await rpc<{ runs: Array<{ ended_at?: string }> }>("runs.list", { agent: agent.id })).runs;
    const say = async (text: string, expected: RegExp) => {
      const before = (await runs()).length;
      await composer.fill(text);
      await page.keyboard.press("Enter");
      await until(async () => {
        const now = await runs();
        return now.length > before && now.every((r) => r.ended_at);
      }, 20_000);
      await expect(page.getByText(expected).last()).toBeVisible({ timeout: 20_000 });
    };

    await say(
      "sign in to t1 field Password with E2E_LOGIN_PASS as password",
      /filled e\d+ on http:\/\/127\.0\.0\.1:7601/,
    );
    await expect(tab.locator("#pw")).toHaveValue(PASSWORD);
    await say("sign in to t1 field Email with E2E_LOGIN_USER as username", /filled e\d+ .* E2E_LOGIN_USER/);
    await expect(tab.locator("#user")).toHaveValue(USER);

    // What the agent reads of the page leaves the values out, even with the password shown as text.
    await tab.getByRole("button", { name: "Show password" }).click();
    const snap = await rpc<{ tree: string }>("browser.snapshot", { tab: "t1" });
    expect(snap.tree).not.toContain(PASSWORD);
    expect(snap.tree).not.toContain(USER);
    expect(snap.tree).toContain("(filled by APX)");

    // A picture of the tab covers both fields: their boxes show no text where an unmasked picture does.
    const shot = await rpc<{ data: string }>("browser.screenshot", { tab: "t1" });
    const plain = (await tab.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
    const boxes = await Promise.all(
      ["#user", "#pw"].map(async (s) => (await tab.locator(s).boundingBox()) ?? undefined),
    );
    const ink = async (jpeg: string) =>
      page.evaluate(
        async ({ jpeg, boxes }) => {
          const img = new Image();
          img.src = `data:image/jpeg;base64,${jpeg}`;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d") as CanvasRenderingContext2D;
          g.drawImage(img, 0, 0);
          // Dark pixels inside each field, its border left out: typed characters.
          return boxes.map((b) => {
            if (!b) return -1;
            const d = g.getImageData(b.x + 6, b.y + 6, b.width - 12, b.height - 12).data;
            let dark = 0;
            for (let i = 0; i < d.length; i += 4)
              if ((d[i] ?? 255) + (d[i + 1] ?? 255) + (d[i + 2] ?? 255) < 300) dark++;
            return dark;
          });
        },
        { jpeg, boxes },
      );
    const [maskedUser, maskedPw] = await ink(shot.data);
    const [plainUser, plainPw] = await ink(plain);
    expect(plainUser).toBeGreaterThan(200);
    expect(plainPw).toBeGreaterThan(200);
    expect(maskedUser).toBeLessThan(20);
    expect(maskedPw).toBeLessThan(20);
    await expect(tab.locator("#pw")).toHaveValue(PASSWORD);

    // No JavaScript runs in a page holding a filled secret, even on the owner's approval.
    // (browser_evaluate is the only way an agent runs page JavaScript; the page refuses it here.)
    await expect(
      Promise.resolve().then(() =>
        cdp.evaluate("document.querySelector('#pw').value", `http://127.0.0.1:${SITE}`, "x"),
      ),
    ).rejects.toThrow(/secret was filled/);

    // Refused: a plain text field, and a password field in a frame from another site, which the snapshot never even
    // gives a ref (cdp-fill.test.ts covers one that has one).
    await say(
      "sign in to t1 field Search with E2E_LOGIN_USER as username",
      /refused: this field takes something other/,
    );
    expect((await rpc<{ tree: string }>("browser.snapshot", { tab: "t1" })).tree).not.toMatch(
      /Partner password.*\[e\d+\]/,
    );
    await say(
      "sign in to t1 field Partner password with E2E_LOGIN_PASS as password",
      /refused: the field is (inside a frame|not in this page)|ref e\d+ is stale or unknown/,
    );
    await expect(tab.locator("#search")).toHaveValue("");
    expect(await tab.frameLocator("iframe").locator("input").inputValue()).toBe("");

    // A page that keeps each field's value on its own attribute, as React does, signs in like any other.
    await tab.goto(`http://127.0.0.1:${SITE}/mirrored`);
    await say("sign in to t1 field Email with E2E_LOGIN_USER as username", /filled e\d+ .* E2E_LOGIN_USER/);
    await say("sign in to t1 field Password with E2E_LOGIN_PASS as password", /filled e\d+ .* E2E_LOGIN_PASS/);
    await expect(tab.locator("#user")).toHaveValue(USER);
    await expect(tab.locator("#pw")).toHaveValue(PASSWORD);
    const mirrored = await rpc<{ tree: string }>("browser.snapshot", { tab: "t1" });
    expect(mirrored.tree).not.toContain(USER);
    expect(mirrored.tree).not.toContain(PASSWORD);

    // Another site: the owner is asked in the app, and says no.
    await tab.goto(`http://127.0.0.1:${OTHER}/login`);
    await composer.fill("sign in to t1 field Password with E2E_LOGIN_PASS as password");
    await page.keyboard.press("Enter");
    const card = page.locator(".inputcard.is-pending");
    await expect(card).toContainText(`http://127.0.0.1:${OTHER}`);
    await card.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByText(/refused: the owner did not allow/).last()).toBeVisible({ timeout: 20_000 });
    await expect(tab.locator("#pw")).toHaveValue("");

    // A page that copies the value: cleared everywhere and kept from the agent.
    await rpc("secrets.set_sites", {
      name: "E2E_LOGIN_PASS",
      sites: [{ origin: `http://127.0.0.1:${SITE}`, kind: "password" }],
    });
    await tab.goto(`http://127.0.0.1:${SITE}/leaky`);
    await say("sign in to t1 field Password with E2E_LOGIN_PASS as password", /refused: the page copied the value/);
    await expect(tab.locator("#pw")).toHaveValue("");
    expect(await tab.evaluate(() => document.body.dataset.seen ?? "")).not.toContain(PASSWORD);
    await expect(rpc("browser.snapshot", { tab: "t1" })).rejects.toThrow(/copied a secret's value/);

    // The value is nowhere but the page: not the chat, the model's requests, the core's log or its database.
    const chat = JSON.stringify(await rpc("threads.get", { thread }));
    for (const value of [PASSWORD, USER]) {
      expect(chat).not.toContain(value);
      expect(await world.modelCarried(value)).toBe(false);
    }
    const log = fs.readFileSync(path.join(dir, "core.log"), "utf8");
    expect(log).toContain('"variable":"E2E_LOGIN_PASS"');
    expect(log).not.toContain(PASSWORD);
    for (const f of fs.readdirSync(home).filter((n) => n.startsWith("apx.db")))
      expect(fs.readFileSync(path.join(home, f)).includes(PASSWORD), f).toBe(false);
  } finally {
    node.close();
    await tab.close();
    for (const s of servers) await new Promise((r) => s.close(r));
  }
});
