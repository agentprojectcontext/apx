// The shared computer: two agents work on two screens at once, a third is refused while the VM holds two, and the
// owner switches between screens and takes one agent's without touching the other (DECISIONS.md#d-152).
import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { expect, test } from "./kit.ts";

async function mockVmDisplay(page: Page) {
  await page.routeWebSocket(/\/vm-display\?/, (socket) => {
    let handshake = 0;
    socket.send(Buffer.from("RFB 003.008\n"));
    socket.onMessage(() => {
      if (handshake === 0) socket.send(Buffer.from([1, 1]));
      if (handshake === 1) socket.send(Buffer.from([0, 0, 0, 0]));
      if (handshake === 2) {
        const init = Buffer.alloc(27);
        init.writeUInt16BE(64, 0);
        init.writeUInt16BE(64, 2);
        init.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0], 4);
        init.writeUInt32BE(3, 20);
        init.write("APX", 24);
        socket.send(init);
      }
      handshake++;
    });
  });
}

test("two agents hold two screens at once, a third waits for room, and the owner takes one screen", async ({
  page,
}) => {
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const ends = new Map<string, () => void>();
  const started = new Set<string>();
  const llm = scriptedLlm(async (req) => {
    const said = String(req.messages.findLast((m) => m.role === "user")?.content ?? "");
    // The owner's words are the input's last line ("chat roby"); APX's own lines above them say "chat" too.
    const who = /^chat (\w+)$/.exec(said.split("\n").at(-1) ?? "")?.[1] ?? "";
    started.add(who);
    await new Promise<void>((resolve) => {
      ends.set(who, resolve);
      req.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
    return say(`Listo ${who}`);
  });
  const screens: number[] = [];
  const env = await startCore({
    llm,
    computer: {
      limaHome: "/unused",
      instance: "missing",
      lifecycle,
      executable: () => "/usr/bin/false",
      screens: {
        start: async (n) => {
          screens.push(n);
        },
        stop: async () => {},
      },
    },
  });
  try {
    await env.client.call("setup.finish", {});
    const chats: Record<string, string> = {};
    for (const agent of ["roby", "scout", "vera"]) {
      await env.client.call("environments.permit", { agent, on: true });
      const chat = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
      await env.client.call("environments.bind", { thread: chat.id });
      chats[agent] = chat.id;
    }
    await env.client.call("environments.status", {});
    for (const agent of ["roby", "scout"])
      await env.client.call("threads.send", { thread: chats[agent] ?? "", text: `chat ${agent}` });
    await expect.poll(() => started.has("roby") && started.has("scout")).toBe(true);
    expect(screens).toEqual([1, 2]);

    // Two screens is all a 4 GiB computer holds: Vera's turn is refused and says who holds them.
    await env.client.call("threads.send", { thread: chats.vera ?? "", text: "chat vera" });
    const refused = await env.settle(chats.vera ?? "");
    expect(refused.runs[0]?.error).toMatch(/all 2 screens the computer can hold are in use \(Roby, Scout\)/);
    expect(started.has("vera")).toBe(false);

    await mockVmDisplay(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${env.core.url}/#thread=${chats.roby}&panel=computer`);
    const computer = page.locator(".computer");
    const picker = computer.getByRole("combobox", { name: "Pantalla" });
    await expect(picker).toHaveText(/Roby · :101 · trabajando/);
    await expect(computer.getByText("2 de 2 pantallas de agentes en uso")).toBeVisible();
    await picker.click();
    await expect(page.getByRole("option")).toHaveText(["Roby · :101 · trabajando", "Scout · :102 · trabajando"]);
    await page.getByRole("option", { name: "Scout · :102 · trabajando" }).click();
    await expect(picker).toHaveText(/Scout/);
    await picker.click();
    await page.getByRole("option", { name: "Roby · :101 · trabajando" }).click();

    // Taking Roby's screen stops Roby's turn; Scout keeps working on its own screen.
    await expect(computer.locator(".computer__locked")).toBeVisible();
    await computer.getByRole("button", { name: "Tomar control", exact: true }).click();
    await expect(computer.getByRole("button", { name: "Devolver control al agente", exact: true })).toBeVisible();
    await expect(computer.locator(".computer__locked")).toHaveCount(0);
    expect((await env.settle(chats.roby ?? "")).runs[0]?.state).toBe("canceled");
    const status = await env.client.call("environments.status", {});
    expect(status.screens?.map((s) => [s.screen, s.agent ?? "", Boolean(s.run), s.control])).toEqual([
      [1, "roby", false, "human"],
      [2, "scout", true, "agent"],
    ]);
    await computer.getByRole("button", { name: "Devolver control al agente", exact: true }).click();
    await expect(computer.locator(".computer__locked")).toBeVisible();
  } finally {
    for (const end of ends.values()) end();
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
  }
});
