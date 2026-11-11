import { expect, open, rpc, test } from "./kit.ts";

const ACCOUNTS = [
  { id: "mail-e2e", type: "email", label: "Email" },
  { id: "wa-sales-e2e", type: "whatsapp", label: "WhatsApp ventas" },
  { id: "wa-home-e2e", type: "whatsapp", label: "WhatsApp casa" },
];

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the filter hides a channel account and groups each account's chats under one row", async ({ page }) => {
  const made: Record<string, string> = {};
  const chats = [
    ["Factura de marzo", "mail-e2e"],
    ["Newsletter semanal", "mail-e2e"],
    ["Aviso de envío", "mail-e2e"],
    ["Cliente Northwind", "wa-sales-e2e"],
    ["Pedido Acme", "wa-sales-e2e"],
    ["Familia", "wa-home-e2e"],
    ["Plan de la semana", ""],
  ] as const;
  for (const [title, account] of chats) {
    const th = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title });
    if (account) made[th.id] = account;
  }
  await page.route("**/rpc/channels.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.channels = [
      ...body.result.channels,
      ...ACCOUNTS.map((a) => ({
        ...a,
        enabled: true,
        agent_id: "superagent",
        strangers: "pair",
        concurrency: "queue",
        owner_thread: "own",
        token_set: true,
        status: "running",
      })),
    ];
    await route.fulfill({ response, json: body });
  });
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.threads = body.result.threads.map((th: { id: string }) =>
      made[th.id] ? { ...th, channel: { id: made[th.id], conversation: `c-${th.id}` } } : th,
    );
    await route.fulfill({ response, json: body });
  });
  await open(page);
  const list = page.locator(".inbox__list");
  await expect(list.getByText("Factura de marzo")).toBeVisible();

  const filter = page.locator(".inboxfilter__btn");
  await filter.click();
  const pop = page.locator(".inboxfilter.apx-popover");
  // Channels come first, each account on its own with how many chats it has.
  await expect(pop.getByRole("tab").first()).toHaveText("Canales");
  await expect(pop.getByRole("tab", { name: "Canales" })).toHaveAttribute("aria-selected", "true");
  const email = pop.locator(".apx-pickrow", { hasText: "Email" });
  await expect(email).toContainText("3");
  await expect(pop.locator(".apx-pickrow", { hasText: "WhatsApp ventas" })).toContainText("2");
  await page.screenshot({ path: "test-results/inbox-channels-filter.png" });

  await email.click();
  await expect(email).toHaveClass(/is-muted/);
  await expect(list.getByText("Factura de marzo")).toHaveCount(0);
  await expect(list.getByText("Cliente Northwind")).toBeVisible();
  await expect(list.getByText("Plan de la semana")).toBeVisible();
  await expect(filter).toHaveAccessibleName(/1/);

  // Hidden stays hidden on this device.
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(list.getByText("Cliente Northwind")).toBeVisible();
  await expect(list.getByText("Factura de marzo")).toHaveCount(0);

  await filter.click();
  await pop.locator(".apx-pickrow", { hasText: "Email" }).click();
  await pop.getByRole("switch", { name: "Agrupar chats por canal" }).click();
  await page.keyboard.press("Escape");
  const sales = list.locator(".channelbundle", { hasText: "WhatsApp ventas" });
  for (const { label } of ACCOUNTS) await expect(list.locator(".channelbundle", { hasText: label })).toHaveCount(1);
  await expect(sales.locator(".channelbundle__chats")).toHaveCount(0);
  await expect(list.getByText("Plan de la semana")).toBeVisible();
  await page.screenshot({ path: "test-results/inbox-channels-grouped.png" });
  await sales.locator(".channelbundle__head").click();
  await expect(sales.locator(".channelbundle__chats").getByText("Pedido Acme")).toBeVisible();
  await page.screenshot({ path: "test-results/inbox-channels-open.png" });

  await page.setViewportSize({ width: 390, height: 800 });
  const toList = page.locator(".chat__header").getByRole("button", { name: "Volver a los chats" });
  if (await toList.isVisible()) await toList.click();
  await expect(sales.locator(".channelbundle__chats").getByText("Pedido Acme")).toBeVisible();
  await page.screenshot({ path: "test-results/inbox-channels-phone.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test("a super-agent chat with no project carries the base project's badge", async ({ page }) => {
  const { base } = await rpc<{ base: { name: string } }>("projects.list");
  await rpc("threads.create", { kind: "loose", agent_id: "superagent", title: "Sin proyecto" });
  await open(page);
  const row = page.locator(".inbox__list .threadrow", { hasText: "Sin proyecto" });
  await expect(row.locator(".projbadge")).toHaveCount(1);
  await expect(row.locator(".projbadge")).toHaveText(base.name);
});

test("one account's list shows what was written: a mail's subject and two lines, a chat's last line", async ({
  page,
}) => {
  const mail = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "superagent",
    title: "Northwind",
  });
  const chat = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "superagent", title: "Acme" });
  const shape: Record<string, { channel: string; preview: string }> = {
    [mail.id]: {
      channel: "mail-e2e",
      preview: "Factura de marzo · Te mando la factura de marzo con el detalle de cada pedido y la fecha de pago.",
    },
    [chat.id]: { channel: "wa-sales-e2e", preview: "¿Me pasás el precio del pedido grande para mañana?" },
  };
  await page.route("**/rpc/channels.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.channels = ACCOUNTS.map((a) => ({
      ...a,
      ...(a.type === "email" ? { email: { address: "ventas@example.com" } } : { account: "+15550100" }),
      enabled: true,
      agent_id: "superagent",
      strangers: "pair",
      concurrency: "queue",
      owner_thread: "own",
      token_set: true,
      status: "running",
    }));
    await route.fulfill({ response, json: body });
  });
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.threads = body.result.threads.map((th: { id: string }) => {
      const s = shape[th.id];
      return s ? { ...th, preview: s.preview, channel: { id: s.channel, conversation: `c-${th.id}` } } : th;
    });
    await route.fulfill({ response, json: body });
  });
  // Opening a chat reads it again: it keeps its account there too.
  await page.route("**/rpc/threads.get", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const s = shape[body.result?.thread?.id];
    if (s)
      body.result.thread = { ...body.result.thread, preview: s.preview, channel: { id: s.channel, conversation: "c" } };
    await route.fulfill({ response, json: body });
  });
  await open(page);
  const sidebar = page.locator(".sidebar");
  // An account named only after its app goes by its address.
  await sidebar.getByRole("button", { name: "ventas@example.com", exact: true }).first().click();
  const back = page.getByRole("button", { name: "Volver a los chats", exact: true });
  if (await back.isVisible()) await back.click();
  await expect(page.locator(".inbox__accountlabel")).toHaveText("ventas@example.com");
  const row = page.locator(".inbox__list .threadrow", { hasText: "Northwind" });
  await expect(row).toHaveClass(/threadrow--mail/);
  await expect(row.locator(".threadrow__subject")).toHaveText("Factura de marzo");
  await expect(row.locator(".threadrow__said")).toContainText("Te mando la factura");
  await expect(row.locator(".projbadge")).toHaveCount(0);
  await page.screenshot({ path: "test-results/inbox-account-mail.png" });

  await sidebar.getByRole("button", { name: "WhatsApp ventas", exact: true }).first().click();
  if (await back.isVisible()) await back.click();
  await expect(page.locator(".inbox__accountsubtext")).toContainText("+15550100");
  const wa = page.locator(".inbox__list .threadrow", { hasText: "Acme" });
  await expect(wa.locator(".apx-convrow__preview")).toHaveText("¿Me pasás el precio del pedido grande para mañana?");
  await expect(wa.locator(".apx-convrow__meta")).not.toContainText("WhatsApp");
  await page.screenshot({ path: "test-results/inbox-account-chat.png" });

  await sidebar.getByRole("button", { name: "ventas@example.com", exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 800 });
  if (await back.isVisible()) await back.click();
  await expect(row.locator(".threadrow__subject")).toBeVisible();
  await page.screenshot({ path: "test-results/inbox-account-mail-phone.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
