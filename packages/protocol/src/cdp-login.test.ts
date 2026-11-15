// In the owner's own browser a form holding a password (filled from their saved logins, or typed) is sent only by
// them: an agent's click or Enter there is refused, in a real Chrome (DECISIONS.md#d-226).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { CdpPage, type CdpSend } from "./cdp.ts";

const PAGE = `<html><body>
  <form id="login" onsubmit="event.preventDefault(); out.textContent = 'sent login'">
    <input aria-label="Email" name="email" value="user@example.com">
    <input aria-label="Password" type="password" name="password">
    <button>Sign in</button>
  </form>
  <form onsubmit="event.preventDefault(); out.textContent = 'sent search'">
    <input aria-label="Search" name="q"><button>Search</button>
  </form>
  <div><input aria-label="Pin" type="password"><button onclick="out.textContent = 'sent pin'">Unlock</button></div>
  <p id="out">Nothing yet</p>
</body></html>`;

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

/** The page as APX drives it, with `out` reading what the page did. */
async function open(
  ownersBrowser: boolean,
): Promise<{ cdp: CdpPage; page: Page; ref: (role: string, name: string) => string }> {
  const page = await browser.newPage();
  await page.setContent(PAGE);
  const session = await page.context().newCDPSession(page);
  const send = ((method: string, params?: object) => session.send(method as never, params as never)) as CdpSend;
  const cdp = new CdpPage(send, { selectAllModifiers: 0, ownersBrowser });
  const { tree } = await cdp.snapshot(20_000);
  const ref = (role: string, name: string) => {
    const found = tree
      .split("\n")
      .find((line) => line.includes(`${role} "${name}"`))
      ?.match(/\be\d+\b/)?.[0];
    assert.ok(found, `${name} in the snapshot`);
    return found;
  };
  return { cdp, page, ref };
}

const said = (page: Page) => page.locator("#out").textContent();

test("in the owner's browser a form holding a password is sent only by them; other forms are not held back", async () => {
  const { cdp, page, ref } = await open(true);
  try {
    // An empty password field holds nothing: the agent may send it.
    await cdp.click(ref("button", "Sign in"));
    assert.equal(await said(page), "sent login");
    // Filled (as Chrome does from saved logins, or the owner typed it): neither a click nor Enter sends it.
    await page.fill("input[name=password]", "correct-horse");
    await page.locator("#out").evaluate((out) => {
      out.textContent = "Nothing yet";
    });
    await assert.rejects(cdp.click(ref("button", "Sign in")), /ask the owner to send it themselves/);
    await assert.rejects(
      cdp.type(ref("textbox", "Email"), "user@example.com", true),
      /ask the owner to send it themselves/,
    );
    assert.equal(await said(page), "Nothing yet");
    // Another form on the same page is not held back by it.
    await cdp.click(ref("button", "Search"));
    assert.equal(await said(page), "sent search");
    // With no form, the document's password fields count: none filled, the click goes; one filled, it waits.
    await page.fill("input[name=password]", "");
    await cdp.click(ref("button", "Unlock"));
    assert.equal(await said(page), "sent pin");
    await page.fill("input[aria-label=Pin]", "4321");
    await assert.rejects(cdp.click(ref("button", "Unlock")), /ask the owner to send it themselves/);
  } finally {
    await page.close();
  }
});

test("APX's own browser still sends a form after a sign-in it filled", async () => {
  const { cdp, page, ref } = await open(false);
  try {
    await page.fill("input[name=password]", "correct-horse");
    await cdp.click(ref("button", "Sign in"));
    assert.equal(await said(page), "sent login");
  } finally {
    await page.close();
  }
});
