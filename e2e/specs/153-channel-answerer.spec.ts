// Who answers a channel chat shows as a face in the lists and the account's header; a room's card docks beside its
// chat like a contact's, and gives the room an agent of its own.
import type { Agent, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const SHOTS = process.env.E2E_SHOTS;

for (const width of [1440, 412]) {
  test(`a room's card docks beside its chat and picks who answers there at ${width}px`, async ({ page }) => {
    await rpc("setup.finish");
    const base = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "superagent", title: "Room base" });
    const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
    const superagent = agents.find((a) => a.id === "superagent");
    if (!superagent) throw new Error("no super-agent");
    const room = {
      ...base,
      id: `${base.id}-room`,
      kind: "channel",
      title: "#general",
      preview: "Ana: hola",
      channel: { id: "community-primary", conversation: "room-general" },
      unread: 0,
    };
    const rooms = {
      rooms: [{ id: "room-general", name: "general", mode: "mention" }],
      names: [],
      owner_only: false,
      knowledge: "",
      rules: "",
      reply_when: "",
      limits: { user_cooldown_s: 20, room_replies_per_hour: 30, checks_per_hour: 120 },
    };
    const account = {
      id: "community-primary",
      type: "discord",
      label: "Community",
      account: "Acme bot",
      enabled: true,
      agent_id: "superagent",
      strangers: "pair",
      concurrency: "queue",
      owner_thread: "own",
      token_set: true,
      status: "running",
      rooms,
    };
    const saved: unknown[] = [];
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/rpc/channels.list", (route) =>
      route.fulfill({ json: { ok: true, result: { channels: [account] } } }),
    );
    await page.route("**/rpc/channels.set", (route) => {
      const { channel } = route.request().postDataJSON() as { channel: Record<string, unknown> };
      saved.push(channel);
      return route.fulfill({ json: { ok: true, result: { channels: [{ ...account, ...channel }] } } });
    });
    await page.route("**/rpc/contacts.list", (route) => route.fulfill({ json: { ok: true, result: { persons: [] } } }));
    await page.route("**/rpc/threads.list", (route) =>
      route.fulfill({ json: { ok: true, result: { threads: [base, room] } } }),
    );
    await page.route("**/rpc/threads.get", (route) => {
      const { thread: id } = route.request().postDataJSON() as { thread: string };
      if (id !== room.id) return route.continue();
      return route.fulfill({ json: { ok: true, result: { thread: room, messages: [], runs: [] } } });
    });

    await open(page, `#thread=${room.id}`);
    const chat = page.locator("section.chat", { has: page.locator(".chat__header") });
    await expect(chat).toBeVisible();
    const card = page.locator(".chan__card--room");
    const pill = page.locator(".chat__roompill");
    if (width < 1280) {
      // Narrow: the card starts closed and covers the chat when asked for.
      await expect(card).toHaveCount(0);
      await pill.click();
    }
    await expect(card).toBeVisible();
    await expect(card.getByText("Atiende", { exact: true })).toBeVisible();
    await expect(card.getByText("Contesta cuando alguien dice su nombre", { exact: false })).toBeVisible();
    await expect(card).not.toContainText("rooms.modeHint");
    if (width >= 1280) {
      // Wide: beside the chat, never over it.
      const c = await chat.boundingBox();
      const k = await card.boundingBox();
      expect(c && k && k.x >= c.x + c.width - 1).toBe(true);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/room-card-${width}.png` });

    await card.getByRole("radio", { name: "Otro agente" }).click();
    await card.getByRole("combobox", { name: "Agente que contesta en #general" }).click();
    // Only the super-agent and project heads answer channels; the super-agent is enough to give the room its own.
    await page.getByRole("option", { name: new RegExp(superagent.name) }).click();
    await card.getByRole("button", { name: "Guardar" }).click();
    await expect.poll(() => saved.length).toBe(1);
    const sent = saved[0] as { rooms: { rooms: Array<{ id: string; agent_id?: string }> } };
    expect(sent.rooms.rooms).toEqual([expect.objectContaining({ id: "room-general", agent_id: superagent.id })]);

    // Beside the chat the pill hides it; over it (a phone), its own close does.
    if (width >= 1280) {
      // Its header gives way: every tool stays inside the chat, none under the card.
      const tools = await page.locator(".chat__header .chat__tools").boundingBox();
      const k = await card.boundingBox();
      expect(tools && k && tools.x + tools.width <= k.x + 1).toBe(true);
      await pill.click();
    } else await card.getByRole("button", { name: "Cerrar" }).click();
    await expect(card).toHaveCount(0);

    // The Inbox narrowed to the account: who answers, by face, and a way to its rooms beside its contacts.
    await page.locator(".sidebar").getByRole("button", { name: "Community", exact: true }).first().click();
    // A phone opens the account's newest chat: its list is one step back.
    if (width < 768) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
    const header = page.locator(".inbox__account");
    await expect(header.getByRole("img", { name: `Atiende ${superagent.name}` })).toBeVisible();
    await expect(header.getByRole("button", { name: "Salas" })).toBeVisible();
    // Which account it is and who answers, without the app's name again.
    await expect(header.locator(".inbox__accountsubtext")).toHaveText(`Acme bot · Atiende ${superagent.name}`);
    const listed = page.locator(".inbox__list .apx-convrow", { hasText: "#general" });
    await expect(listed.getByRole("img", { name: `Atiende ${superagent.name}` })).toBeVisible();
    // Its row: what was written last, then who answers; no project badge, no app name.
    await expect(listed.locator(".apx-convrow__preview")).toHaveText("Ana: hola");
    await expect(listed.locator(".apx-convrow__meta")).toHaveText(`Atiende ${superagent.name}`);
    await expect(listed.locator(".projbadge")).toHaveCount(0);
    // The account's list has its search.
    const find = page.locator(".inbox__accountfind input");
    await find.fill("nadie así");
    await expect(listed).toHaveCount(0);
    await find.fill("hola");
    await expect(listed).toBeVisible();
    await find.fill("");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-account-${width}.png` });

    // The account's own screen: who answers in its header, a way to its rooms, and each room's answerer.
    await open(page, "#channel=community-primary");
    const head = page.locator(".chan__head");
    await expect(head.getByRole("img", { name: `Atiende ${superagent.name}` })).toBeVisible();
    await expect(head.getByRole("button", { name: "Salas" })).toBeVisible();
    // As slim as the Inbox's: which account it is and who answers; no note under the list.
    await expect(head.locator(".chan__metatext")).toHaveText(`Acme bot · Atiende ${superagent.name}`);
    await expect(page.getByText("Conversaciones con otras personas", { exact: false })).toHaveCount(0);
    if (width >= 1280) {
      // Its edge resizes it, like the Inbox's list.
      const edge = page.getByRole("separator", { name: "Cambiar el ancho de la lista" });
      const before = (await page.locator(".chan__list").boundingBox())?.width ?? 0;
      const box = await edge.boundingBox();
      if (!box) throw new Error("no list edge");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await page.locator(".chan__list").boundingBox())?.width ?? 0)
        .toBeGreaterThan(before + 30);
    }
    const row = page.locator(".chan__row", { hasText: "#general" });
    await expect(row.getByRole("img", { name: `Atiende ${superagent.name}` })).toBeVisible();
    await expect(row.locator(".chan__rel")).toHaveText(`Cuando lo llaman · Atiende ${superagent.name}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/channel-screen-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await page.unrouteAll({ behavior: "wait" });
    await rpc("threads.delete", { thread: base.id });
  });
}
