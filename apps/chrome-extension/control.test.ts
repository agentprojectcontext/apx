// The whole path in a real Chromium: the owner writes in APX's panel, the core routes that turn's browser tools to
// `apx chrome-host` (started by Chromium over native messaging), and the extension opens and reads a tab in its "APX"
// group. Words written anywhere else never touch Chrome.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { expect } from "@playwright/test";
import { callTool, say } from "../core/src/engine/testkit.ts";
import { withPanel } from "./testkit.ts";

const ORDERS = `<!doctype html><html lang="en"><head><title>Northwind orders</title></head>
<body><h1>Orders</h1><button type="button">Ship order 42</button></body></html>`;

test("a turn written in the panel opens and reads a tab of Chrome's APX group, and only that turn", async () => {
  // Windows finds native hosts through the registry, which APX does not write yet (DECISIONS.md#d-198).
  if (process.platform === "win32") return;
  const site = http.createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(ORDERS));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  const orders = `http://127.0.0.1:${(site.address() as AddressInfo).port}/orders`;
  /** The tab the next scripted read goes to (the test sets it). */
  let target = "";
  try {
    await withPanel(
      "en",
      false,
      async ({ client, core, context, frame, worker }) => {
        // Read in the extension's own worker: the addresses of the tabs in Chrome's APX group.
        const groupTabs = async () =>
          (await worker.evaluate(`(async () => {
            const ids = new Set((await chrome.tabGroups.query({ title: "APX" })).map((g) => g.id));
            return (await chrome.tabs.query({})).filter((t) => ids.has(t.groupId)).map((t) => t.url);
          })()`)) as string[];
        const code = (await client.call("devices.pair_start", {})).code;
        await frame.locator("input").fill(code);
        await frame.locator('button[type="submit"]').click();
        await expect(frame.locator("textarea")).toBeVisible();

        await frame.locator("textarea").fill("Open the orders page");
        await frame.locator("textarea").press("Enter");
        await expect(frame.getByText(/Seen: .*Ship order 42/)).toBeVisible({ timeout: 30_000 });
        assert.deepEqual(await groupTabs(), [orders]);
        const ordersTab = Number(
          await worker.evaluate(`chrome.tabs.query({ url: ${JSON.stringify(orders)} }).then((t) => t[0].id)`),
        );
        // The chat says the tab is in Chrome instead of offering APX's browser for it.
        await expect(frame.locator(".browserpart__chrome")).toContainText("Northwind orders");

        // Moved out of the group the tab is the owner's again; moved back in, the agent can read it again.
        await worker
          .evaluate(`(async () => {
          const group = (await chrome.tabs.get(${ordersTab})).groupId;
          await chrome.tabs.ungroup(${ordersTab});
          await new Promise((r) => setTimeout(r, 300));
          await chrome.tabs.group({ tabIds: [${ordersTab}], groupId: (await chrome.tabGroups.query({ title: "APX" }))[0]?.id ?? group });
        })()`)
          .catch(async () => {
            // Ungrouping the only tab removes the group: make a new one titled APX.
            await worker.evaluate(`(async () => {
            const id = await chrome.tabs.group({ tabIds: [${ordersTab}] });
            await chrome.tabGroups.update(id, { title: "APX" });
          })()`);
          });
        target = `c${ordersTab}`;
        await frame.locator("textarea").fill("Read the tab again");
        await frame.locator("textarea").press("Enter");
        await expect(frame.getByText(/Again: .*Ship order 42/)).toBeVisible({ timeout: 30_000 });

        // APX's own screen dragged into the group stays out of reach.
        const apx = await context.newPage();
        await apx.goto(`${core.url}/?quick`);
        const apxTab = Number(
          await worker.evaluate(`(async () => {
            const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(`${core.url}/*`)} });
            const [group] = await chrome.tabGroups.query({ title: "APX" });
            await chrome.tabs.group({ tabIds: [tab.id], groupId: group.id });
            return tab.id;
          })()`),
        );
        target = `c${apxTab}`;
        await frame.locator("textarea").fill("Read the tab again");
        await frame.locator("textarea").press("Enter");
        await expect(frame.getByText(/Again: .*shows APX itself/)).toBeVisible({ timeout: 30_000 });

        // The same request from anywhere else is not a Chrome turn: no browser tool, no new tab.
        const before = await groupTabs();
        const thread = (await client.call("threads.create", { kind: "agent", agent_id: "superagent" })).id;
        await client.call("threads.send", { thread, text: "Open the orders page from elsewhere" });
        await expect
          .poll(async () => (await client.call("threads.get", { thread })).runs.every((r) => r.ended_at), {
            timeout: 15_000,
          })
          .toBe(true);
        assert.deepEqual(await groupTabs(), before);
      },
      {
        nativeHost: true,
        script: (req, { said }) => {
          const results = req.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
          if (said.includes("tab again"))
            return results.length && req.messages.at(-1)?.role === "tool"
              ? say(`Again: ${results.at(-1)?.replace(/\s+/g, " ").slice(0, 600)}`)
              : callTool(`r${req.messages.length}`, "browser_snapshot", { tab: target });
          if (!said.includes("orders page")) return say("ok");
          if (said.includes("elsewhere"))
            return results.length
              ? say(`Result: ${results[0]?.slice(0, 200)}`)
              : callTool("e1", "browser_open", { url: orders });
          if (!results.length) return callTool("o1", "browser_open", { url: orders });
          const tab = /tab (c\d+)/.exec(results[0] ?? "")?.[1];
          if (results.length === 1) return callTool("s1", "browser_snapshot", { tab });
          return say(`Seen: ${results.at(-1)?.replace(/\s+/g, " ").slice(0, 600)}`);
        },
      },
    );
  } finally {
    await new Promise((resolve) => site.close(resolve));
  }
});
