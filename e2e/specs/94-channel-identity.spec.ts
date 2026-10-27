import type { Agent, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

for (const width of [412, 1280]) {
  test(`contact and channel identity in every Inbox view and header at ${width}px`, async ({ page }) => {
    await rpc("setup.finish");
    const base = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Identity fixture" });
    const { agents } = await rpc<{ agents: Agent[] }>("agents.list");
    const agent = agents.find((item) => item.id === base.agent_ids[0]);
    if (!agent) throw new Error("Identity fixture agent not found");
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      document.addEventListener(
        "error",
        (event) => {
          const image = event.target;
          if (image instanceof HTMLImageElement && image.classList.contains("chan__avatarimg")) {
            image.parentElement?.setAttribute("data-image-error", "true");
          }
        },
        true,
      );
    });
    const cases = [
      {
        title: "Photo Acme",
        person: "person-photo",
        channel: { id: "line-primary", conversation: "acme", person_id: "person-photo" },
        platform: "WhatsApp",
        identity: "Photo Acme",
        picture: true,
      },
      {
        title: "No Photo",
        person: "person-none",
        channel: { id: "line-primary", conversation: "none", person_id: "person-none" },
        platform: "WhatsApp",
        identity: "No Photo",
        picture: false,
      },
      {
        title: "Broken Photo",
        person: "person-broken",
        channel: { id: "line-primary", conversation: "broken", person_id: "person-broken" },
        platform: "WhatsApp",
        identity: "Broken Photo",
        picture: false,
      },
      {
        title: "Room Northwind",
        channel: { id: "community-primary", conversation: "room-general" },
        platform: "Discord",
        identity: "Room Northwind",
        picture: false,
      },
      {
        title: "Foreign Person",
        channel: { id: "line-primary", conversation: "foreign", person_id: "person-foreign" },
        platform: "WhatsApp",
        identity: "Foreign Person",
        picture: false,
      },
      {
        title: "WhatsApp ordinary chat",
        channel: undefined,
        platform: undefined,
        identity: agent.name,
        picture: false,
        internal: true,
      },
      {
        title: "Unavailable channel",
        channel: { id: "unknown-channel", conversation: "unknown" },
        platform: undefined,
        identity: "Unavailable channel",
        picture: false,
      },
    ];
    const threads = cases.map((item, i) => ({
      ...base,
      id: `${base.id}-${i}`,
      title: item.title,
      preview: item.title,
      channel: item.channel,
      unread: i === 1 ? 0 : 1,
    }));
    const person = (id: string, name: string, channel: string) => ({
      id,
      name,
      role: "contact",
      muted: false,
      unreviewed: false,
      supervised: false,
      any_hour: false,
      perms: { appointments: false, requests: false, notes: false },
      addresses: [{ id: `address-${id}`, person_id: id, channel, external_id: id }],
      created_at: base.created_at,
    });
    await page.route("**/rpc/channels.list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            channels: [
              { id: "line-primary", type: "whatsapp", label: "Personal line" },
              { id: "community-primary", type: "discord", label: "Community" },
            ].map((channel) => ({
              ...channel,
              enabled: true,
              agent_id: "roby",
              strangers: "pair",
              concurrency: "queue",
              owner_thread: "own",
              token_set: true,
              status: "running",
            })),
          },
        },
      }),
    );
    await page.route("**/rpc/contacts.list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            persons: [
              person("person-photo", "Photo Acme", "line-primary"),
              person("person-none", "No Photo", "line-primary"),
              person("person-broken", "Broken Photo", "line-primary"),
              person("person-foreign", "Foreign Name", "community-primary"),
            ],
          },
        },
      }),
    );
    const avatarCalls: string[] = [];
    await page.route("**/rpc/contacts.avatar", (route) => {
      const { person: id } = route.request().postDataJSON() as { person: string };
      avatarCalls.push(id);
      const media_id = id === "person-photo" ? "photo-media" : id === "person-broken" ? "broken-media" : undefined;
      return route.fulfill({ json: { ok: true, result: media_id ? { media_id } : {} } });
    });
    await page.route("**/rpc/media.get", (route) => {
      const { id } = route.request().postDataJSON() as { id: string };
      return route.fulfill({
        json: { ok: true, result: { mime: "image/png", data: id === "photo-media" ? PNG : "bm90IGFuIGltYWdl" } },
      });
    });
    const readCalls: string[] = [];
    await page.route("**/rpc/threads.read", (route) => {
      const { thread: id } = route.request().postDataJSON() as { thread: string };
      if (!threads.some((thread) => thread.id === id)) return route.continue();
      readCalls.push(id);
      return route.fulfill({ json: { ok: true, result: { ok: true } } });
    });
    await page.route("**/rpc/threads.list", (route) => route.fulfill({ json: { ok: true, result: { threads } } }));
    await page.route("**/rpc/threads.get", (route) => {
      const { thread: id } = route.request().postDataJSON() as { thread: string };
      const thread = threads.find((item) => item.id === id);
      if (!thread) return route.continue();
      return route.fulfill({ json: { ok: true, result: { thread, messages: [], runs: [] } } });
    });
    await open(page);
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    if (width < 768) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
    await expect(page.locator(".inbox__list")).toBeVisible();
    for (const view of ["Árbol", "Actividad", "Por chat"]) {
      await page.getByRole("radio", { name: view, exact: true }).click();
      for (const item of cases) {
        const row = page
          .locator(
            view === "Árbol" && item.channel
              ? ".inbox__list .tree__channel"
              : ".inbox__list .tree__session, .inbox__list .activity__row, .inbox__list .apx-convrow",
          )
          .filter({ hasText: item.title })
          .first();
        await expect(row).toBeVisible();
        const avatar = row.locator(".threadavatar");
        await expect(avatar.getByRole("img", { name: item.identity, exact: true })).toBeVisible();
        if (item.picture) {
          const image = avatar.locator("img.chan__avatarimg");
          await expect(image).toBeVisible();
          await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          const size = view === "Árbol" ? 20 : view === "Actividad" ? 24 : 32;
          const imageBox = await image.boundingBox();
          const parentBox = await avatar.getByRole("img", { name: item.identity, exact: true }).boundingBox();
          expect(imageBox).not.toBeNull();
          expect(parentBox).not.toBeNull();
          expect(imageBox?.width).toBe(size);
          expect(imageBox?.height).toBe(size);
          expect(parentBox?.width).toBe(size);
          expect(parentBox?.height).toBe(size);
        } else if (!item.internal) {
          if (item.person === "person-broken")
            await expect(avatar.getByRole("img", { name: item.identity, exact: true })).toHaveAttribute(
              "data-image-error",
              "true",
            );
          await expect(avatar.locator("img.chan__avatarimg")).toHaveCount(0);
          await expect(avatar.getByRole("img", { name: agent.name, exact: true })).toHaveCount(0);
        }
        const mark = avatar.locator(".threadavatar__channel");
        await expect(mark).toHaveCount(0);
        if (item.platform) {
          await expect(row).toContainText(`Por ${item.platform}`);
          if (view === "Árbol") {
            await expect(row.locator(".tree__agentmeta")).toHaveText(`Por ${item.platform}`);
            await expect(row).not.toContainText("Super-agente");
            const face = await avatar.boundingBox();
            const title = await row.locator(".tree__agentname").boundingBox();
            expect(face).not.toBeNull();
            expect(title).not.toBeNull();
            expect(
              Math.abs((face ? face.y + face.height / 2 : 0) - (title ? title.y + title.height / 2 : 0)),
            ).toBeLessThan(1);
          }
        }
      }
      if (view === "Árbol") {
        const channelRow = page.locator(".inbox__list .tree__channel").filter({ hasText: "Photo Acme" });
        const readRow = page.locator(".inbox__list .tree__channel").filter({ hasText: "No Photo" });
        await expect(channelRow.locator(".tree__unread")).toHaveText("1");
        await expect(channelRow.locator(".tree__agentname")).toHaveCSS("font-weight", "600");
        await expect(readRow.locator(".tree__unread")).toHaveCount(0);
        await expect(readRow.locator(".tree__agentname")).toHaveCSS("font-weight", "400");
        await channelRow.click();
        await expect(
          page.locator(".chan__chathead").getByRole("img", { name: "Photo Acme", exact: true }),
        ).toBeVisible();
        if (width < 768) await page.getByRole("button", { name: /Volver a los (chats|contactos)/ }).click();
        await expect(channelRow).toHaveClass(/is-selected/);
        await expect(channelRow).toHaveCSS("box-shadow", /inset/);
      }
    }
    for (const item of cases) {
      const row = page.locator(".inbox__list .apx-convrow").filter({ hasText: item.title }).first();
      await row.click();
      const header = page.locator(".chat__header, .chan__chathead").first();
      await expect(header).toBeVisible();
      const headerIdentity = item.internal ? `${agent.name} (En línea)` : item.identity;
      await expect(header.getByRole("img", { name: headerIdentity, exact: true })).toBeVisible();
      if (item.picture) await expect(header.locator("img.chan__avatarimg")).toBeVisible();
      else if (!item.internal) {
        if (item.person === "person-broken")
          await expect(header.getByRole("img", { name: item.identity, exact: true })).toHaveAttribute(
            "data-image-error",
            "true",
          );
        await expect(header.locator("img.chan__avatarimg")).toHaveCount(0);
      }
      if (item.title === "Foreign Person") {
        await expect(header).not.toContainText("Foreign Name");
        await expect(page.locator(".chan__card")).toHaveCount(0);
        await header.locator(".chan__who").click();
        await expect(page.locator(".chan__card")).toHaveCount(0);
        await expect(page.getByText("Foreign Name", { exact: true })).toHaveCount(0);
      }
      if (item.platform)
        await expect(header.getByRole("img", { name: `Por ${item.platform}`, exact: true })).toBeVisible();
      else await expect(header.locator(".threadavatar__channel")).toHaveCount(0);
      if (width < 768) await page.getByRole("button", { name: /Volver a los (chats|contactos)/ }).click();
    }
    expect(readCalls.length).toBeGreaterThan(0);
    expect(readCalls.every((id) => threads.some((thread) => thread.id === id))).toBe(true);
    expect(avatarCalls).toContain("person-photo");
    expect(avatarCalls).toContain("person-none");
    expect(avatarCalls).toContain("person-broken");
    expect(avatarCalls).not.toContain("person-foreign");
    expect(avatarCalls.every((id) => ["person-photo", "person-none", "person-broken"].includes(id))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
