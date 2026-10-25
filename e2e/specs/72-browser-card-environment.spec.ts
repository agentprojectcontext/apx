import path from "node:path";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import type { Part } from "../../packages/protocol/src/index.ts";
import { expect, test } from "./kit.ts";

test("guest browser cards, including old messages, stay in the VM; an open panel replaces the preview", async ({
  page,
}) => {
  const home = tempDir("apx-browser-card-").path;
  const env = await startCore({
    home,
    llm: scriptedLlm(() => say("ok")),
    computer: { limaHome: path.join(home, "no-vms"), instance: "missing" },
  });
  const desktop = await env.client.connect("node", ["browser"]);
  const hostCalls: string[] = [];
  desktop.onRequest(async (method) => {
    hostCalls.push(method);
    if (method === "browser.tabs")
      return {
        tabs: [
          {
            tab: "h1",
            url: "https://example.com/host",
            title: "Host page",
            profile: "shared",
            control: { kind: "idle" },
          },
          {
            tab: "h2",
            url: "https://example.com/other",
            title: "Other page",
            profile: "shared",
            control: { kind: "idle" },
          },
        ],
      };
    if (method === "browser.screenshot") {
      const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lpUAAAAASUVORK5CYII=";
      return { mime: "image/jpeg", data, bytes: Buffer.byteLength(data, "base64") };
    }
    throw new Error(`unexpected host browser call: ${method}`);
  });
  const add = (thread: string, title: string, tab: string, environment?: "vm") => {
    const part: Part = {
      type: "browser",
      tab,
      title,
      url: "https://example.com/guest",
      state: "agent",
      ...(environment ? { environment } : {}),
    };
    env.core.store.messages.add({ thread_id: thread, author: { kind: "agent", id: "roby" }, parts: [part] });
  };
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("environments.permit", { agent: "roby", on: true });
    // Home stays on this Mac (DECISIONS.md#d-154): Roby works on the computer in a chat of its own.
    const chat = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "En la computadora",
    });
    await env.client.call("environments.bind", { thread: chat.id });
    add(chat.id, "Legacy guest page", "h1");
    add(chat.id, "Tagged guest page", "vm-1", "vm");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${env.core.url}/#thread=${chat.id}`);
    const legacy = page.getByRole("button", { name: "Computadora: Legacy guest page", exact: true });
    await expect(legacy).toBeVisible();
    await expect(page.getByRole("button", { name: "Computadora: Tagged guest page", exact: true })).toBeVisible();
    await expect(page.locator(".apx-livebrowser__preview")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir de nuevo", exact: true })).toHaveCount(0);
    await legacy.click();
    await expect(page.locator(".computer")).toBeVisible();
    await expect(page).toHaveURL(/panel=computer/);
    await expect(page.locator(".apx-livebrowser__preview")).toHaveCount(0);
    expect(hostCalls.filter((method) => method !== "browser.tabs")).toEqual([]);
    await page.locator(".computer").getByRole("button", { name: "Cerrar panel", exact: true }).click();
    await expect(page.locator(".computer")).toHaveCount(0);
    await expect(page).not.toHaveURL(/panel=computer/);
    expect((await env.client.call("environments.status", {})).chats).toEqual([chat.id]);
    await legacy.click();
    await expect(page.locator(".computer")).toBeVisible();
    expect(hostCalls.filter((method) => method !== "browser.tabs")).toEqual([]);

    const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    add(other.id, "Ordinary host page", "h1");
    await page.goto(`${env.core.url}/#thread=${other.id}`);
    await expect(page.locator(".apx-livebrowser__preview")).toHaveCount(1);
    await page.locator(".apx-livebrowser__preview").click();
    await expect(page).toHaveURL(/panel=browser/);
    await expect(page.locator(".browser__page")).toBeVisible();
    await expect(page.locator(".apx-livebrowser__preview")).toHaveCount(0);
    await expect(page.locator(".browserpart__compact")).toContainText("Host page");

    // Another selected tab must not suppress this card's preview.
    await page.getByRole("tab", { name: /Other page/ }).click();
    await expect(page.locator(".apx-livebrowser__preview")).toHaveCount(1);
    expect(hostCalls).not.toContain("browser.open");
  } finally {
    await page.goto("about:blank");
    desktop.close();
    await env.core.close();
    env.cleanup();
  }
});
