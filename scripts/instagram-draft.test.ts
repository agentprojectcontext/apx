import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";

const script = path.join(import.meta.dirname, "browser/instagram-draft.js");
const options = {
  recipient: "acme",
  threadId: "123",
  text: "A test draft",
  conversationSelector: "#chat",
  messagesSelector: ".bubble",
};

test("Instagram helper composes once, fails closed on a recipient mismatch, and sends only with explicit opt-in", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://www.instagram.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<main id="chat"><header><a href="/acme/">Acme</a></header><div id="messages"></div><div contenteditable="true" role="textbox"></div><button>Send</button></main>',
      }),
    );
    await page.goto("https://www.instagram.com/direct/t/123/");
    await page.addScriptTag({ path: script });
    await page.evaluate(() => {
      const button = document.querySelector("button");
      button?.addEventListener("click", () => {
        const editor = document.querySelector('[role="textbox"]');
        if (!editor) throw new Error("Missing test editor");
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = editor.textContent;
        document.querySelector("#messages")?.append(bubble);
        editor.textContent = "";
      });
    });
    const run = (args: object) =>
      page.evaluate(async (a) => {
        const helper = (
          globalThis as unknown as { apxInstagramDraft: (args: object) => Promise<{ status: string; sent: boolean }> }
        ).apxInstagramDraft;
        return helper(a);
      }, args);
    await assert.rejects(run({ ...options, recipient: "northwind" }), /expected recipient/);
    assert.equal(await page.locator('[role="textbox"]').innerText(), "");
    assert.equal((await run(options)).status, "composed");
    assert.equal((await run(options)).sent, false);
    assert.equal(await page.locator('[role="textbox"]').innerText(), options.text);
    assert.equal(await page.locator(".bubble").count(), 0);
    await assert.rejects(run({ ...options, send: true }), /confirmSend/);
    assert.equal(await page.locator(".bubble").count(), 0);
    const sent = await run({ ...options, send: true, confirmSend: "SEND acme" });
    assert.equal(sent.status, "bubble_verified");
    assert.equal(sent.sent, true);
    assert.equal((await run({ ...options, send: true, confirmSend: "SEND acme" })).status, "already_present");
    assert.equal(await page.locator(".bubble").count(), 1);
    await assert.rejects(run({ ...options, threadId: "999" }), /Wrong conversation/);
    await page.reload();
    await page.addScriptTag({ path: script });
    await page.evaluate(() => {
      document.querySelector('[role="textbox"]')?.addEventListener("input", () => {
        document.querySelector("header a")?.setAttribute("href", "/northwind/");
      });
    });
    await assert.rejects(
      run({ ...options, text: "Another test draft", send: true, confirmSend: "SEND acme" }),
      /expected recipient/,
    );
    assert.equal(await page.locator(".bubble").count(), 0);
    await page.close();
  } finally {
    await browser.close();
  }
});
