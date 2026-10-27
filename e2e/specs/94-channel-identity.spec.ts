import type { Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const width of [412, 1280]) {
  test(`channel identity uses instance metadata in every Inbox view at ${width}px`, async ({ page }) => {
    await rpc("setup.finish");
    const base = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Identity fixture" });
    await page.setViewportSize({ width, height: 1000 });
    const cases = [
      { title: "Contact Acme", channel: { id: "line-primary", conversation: "contact-acme" }, platform: "WhatsApp" },
      {
        title: "Room Northwind",
        channel: { id: "community-primary", conversation: "room-general" },
        platform: "Discord",
      },
      {
        title: "Contact Northwind",
        channel: { id: "community-primary", conversation: "contact-northwind" },
        platform: "Discord",
      },
      { title: "WhatsApp ordinary chat", channel: undefined, platform: undefined },
      { title: "Unavailable channel", channel: { id: "discord", conversation: "unknown" }, platform: undefined },
    ];
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
    await page.route("**/rpc/threads.list", (route) =>
      route.fulfill({
        json: {
          ok: true,
          result: {
            threads: cases.map((item, i) => ({
              ...base,
              id: `${base.id}-${i}`,
              title: item.title,
              preview: item.title,
              channel: item.channel,
              unread: 1,
            })),
          },
        },
      }),
    );
    await open(page);
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    if (width < 768) await page.getByRole("button", { name: "Volver a los chats", exact: true }).click();
    await expect(page.locator(".inbox__list")).toBeVisible();
    for (const view of ["Árbol", "Actividad", "Por chat"]) {
      await page.getByRole("radio", { name: view, exact: true }).click();
      for (const item of cases) {
        const row = page
          .locator(".inbox__list .tree__session, .inbox__list .activity__row, .inbox__list .apx-convrow")
          .filter({ hasText: item.title })
          .first();
        await expect(row).toBeVisible();
        await expect(row.locator(".threadavatar").getByRole("img", { name: "Roby", exact: true })).toBeVisible();
        const mark = row.locator(".threadavatar__channel");
        if (item.platform) {
          await expect(mark).toHaveAccessibleName(`Por ${item.platform}`);
          await expect(mark.locator(".apx-chanicon svg")).toBeVisible();
          await mark.hover();
          await expect(page.locator(".apx-tooltip")).toHaveText(`Por ${item.platform}`);
          await page.mouse.move(width - 10, 10);
          await expect(page.locator(".apx-tooltip")).not.toBeVisible();
          if (view !== "Árbol") await expect(row).toContainText(`Por ${item.platform}`);
        } else {
          await expect(mark).toHaveCount(0);
          await expect(row.locator(".apx-chanicon")).toHaveCount(0);
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}
