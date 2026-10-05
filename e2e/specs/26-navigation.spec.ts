import { expect, open, rpc, test } from "./kit.ts";

test.beforeAll(async () => {
  await rpc("setup.finish");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Buscador mantiene input sin resaltado y separa Esc del cierre en ambos temas", async ({ page }) => {
  await open(page);
  for (const mode of ["dark", "light"]) {
    await page
      .locator(".apx")
      .first()
      .evaluate((root, mode) => root.setAttribute("data-apx-mode", mode), mode);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.keyboard.press("ControlOrMeta+k");
      const box = page.getByRole("textbox", { name: "Buscar", exact: true });
      await expect(box).toBeFocused();
      await expect(box).toHaveCSS("outline-style", "none");
      await expect(box).toHaveCSS("box-shadow", "none");
      const geometry = await page.locator(".palette").evaluate((palette) => {
        const badge = palette.querySelector("kbd")?.getBoundingClientRect();
        const close = palette.querySelector(".apx-dialog__close")?.getBoundingClientRect();
        return { gap: badge && close ? close.left - badge.right : -1 };
      });
      expect(geometry.gap).toBeGreaterThanOrEqual(8);
      await page.keyboard.press("Escape");
      await expect(box).toBeHidden();
    }
  }
});

test("Cmd, Windows y Ctrl resaltan atajos; soltar o perder foco limpia resaltado", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 1480, height: 800 });
  const hint = page.locator(".topbar__search kbd");
  for (const mode of ["dark", "light"]) {
    await page
      .locator(".apx")
      .first()
      .evaluate((root, mode) => root.setAttribute("data-apx-mode", mode), mode);
    const resting = await hint.evaluate((el) => getComputedStyle(el).color);
    const active = await page
      .locator(".apx")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    for (const key of ["Meta", "Control"]) {
      await page.keyboard.down(key);
      await expect(hint).toHaveCSS("color", active);
      await page.keyboard.up(key);
      await expect(hint).toHaveCSS("color", resting);
    }
    await page.keyboard.down("Meta");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(hint).toHaveCSS("color", resting);
    await page.keyboard.up("Meta");
  }
});

test("Atrás y Adelante restauran pantalla y chat; navegar después descarta futuro", async ({ page }) => {
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: "roby",
    title: "Una conversación con nombre largo para comprobar ubicación",
  });
  await open(page, `#thread=${chat.id}&panel=usage`);
  const bar = page.locator(".topbar");
  const back = bar.getByRole("button", { name: "Atrás", exact: true });
  const forward = bar.getByRole("button", { name: "Adelante", exact: true });
  await expect(back).toBeDisabled();
  await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
  await page.getByRole("button", { name: "Recursos", exact: true }).first().click();
  await back.click();
  await expect(page).toHaveURL(/#view=tasks$/);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page).toHaveURL(new RegExp(`#thread=${chat.id}&panel=usage$`));
  await expect(page.getByRole("complementary", { name: "Panel lateral" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+]");
  await expect(page).toHaveURL(/#view=tasks$/);
  await forward.click();
  await expect(page).toHaveURL(/#view=resources$/);
  await expect(forward).toBeDisabled();
  await back.click();
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(forward).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByRole("dialog", { name: "Configuración" })).toBeVisible();
  await page.keyboard.press("Escape");
  await back.click();
  await expect(page).toHaveURL(/#view=tasks$/);
});

for (const platform of ["web", "mac", "win", "linux"])
  test(`${platform}: buscador centrado, controles accesibles, breadcrumb largo sin solapar`, async ({ page }) => {
    const chat = await rpc<{ id: string }>("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Una conversación con título tan largo que supera espacio disponible barra superior",
    });
    await page.route("**/rpc/system.updates", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, result: { ...body.result, behind: 12, changes: ["feat: navigation"] } },
      });
    });
    await page.route("**/rpc/threads.list", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const threads = body.result.threads.map((thread: { id: string; state: string }, i: number) => ({
        ...thread,
        state: i === 0 ? "working" : i === 1 ? "input-required" : thread.state,
      }));
      await route.fulfill({ response, json: { ...body, result: { ...body.result, threads } } });
    });
    await open(page, `#thread=${chat.id}`);
    await expect(page.getByRole("button", { name: "Actualización · 12" })).toBeVisible();
    if (platform !== "web")
      await page.locator(".topbar").evaluate((bar, os) => bar.classList.add("is-desktop", `is-${os}`), platform);
    for (const width of platform === "web" ? [1480, 1280, 980, 800, 390] : [1480, 1280, 1100, 980]) {
      await page.setViewportSize({ width, height: 800 });
      const search = page.locator(".topbar__search");
      await expect(async () => {
        const geometry = await page.locator(".topbar").evaluate((bar) => {
          const search = bar.querySelector(".topbar__search")?.getBoundingClientRect();
          const controls = [...bar.querySelectorAll("button")].filter((button) => button.getClientRects().length);
          return {
            center: search ? search.x + search.width / 2 : -1,
            overlaps: controls
              .filter((button) => {
                const b = button.getBoundingClientRect();
                return (
                  !button.classList.contains("topbar__search") &&
                  search &&
                  b.right > search.left &&
                  b.left < search.right
                );
              })
              .map((button) => button.getAttribute("aria-label")),
            outOfBounds: controls
              .filter((button) => {
                const b = button.getBoundingClientRect();
                return b.left < 0 || b.right > innerWidth;
              })
              .map((button) => button.getAttribute("aria-label")),
          };
        });
        expect(geometry.center).toBeCloseTo(width / 2, 0);
        expect(geometry.overlaps, `overlaps at ${width}px`).toEqual([]);
        expect(geometry.outOfBounds).toEqual([]);
      }).toPass({ timeout: 3000 });
      await search.click();
      await expect(page.getByRole("textbox", { name: "Buscar", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

test("Sesiones externas: plegado independiente, persistente y accesible desde barra compacta", async ({ page }) => {
  await page.setViewportSize({ width: 1480, height: 800 });
  await page.route("**/rpc/engines.status", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          engines: [{ id: "codex", label: "Codex", installed: true, logged_in: false, default: false }],
        },
      },
    });
  });
  await open(page);
  const sidebar = page.locator(".sidebar");
  const fold = sidebar.getByRole("button", { name: "Sesiones externas", exact: true });
  const engine = sidebar.getByRole("button", { name: /^Codex/ });
  const projects = sidebar.getByRole("button", { name: "Proyectos", exact: true });
  const channels = sidebar.getByRole("button", { name: "Canales", exact: true });
  await expect(engine).toBeVisible();
  await fold.focus();
  await page.keyboard.press("Space");
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(engine).toBeHidden();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await expect(channels).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(engine).toBeHidden();
  await page.getByRole("button", { name: "Plegar la barra", exact: true }).click();
  await expect(engine).toBeVisible();
  await page.getByRole("button", { name: "Desplegar la barra", exact: true }).click();
  await expect(engine).toBeHidden();
  await fold.click();
  await expect(engine).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
});

test("Canales: tres visibles, orden persistente y sin leer visibles también en Más y barra plegada", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1480, height: 800 });
  await page.addInitScript(() => {
    if (!localStorage.getItem("apx.prefs"))
      localStorage.setItem(
        "apx.prefs",
        JSON.stringify({
          channelOrder: ["telegram", "discord", "whatsapp", "slack", "email"],
          channelOrderAt: new Date().toISOString(),
        }),
      );
  });
  const slack = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Avisos Slack" });
  const email = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby", title: "Avisos Email" });
  let unread = true;
  await page.route("**/rpc/channels.list", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        result: {
          channels: ["telegram", "discord", "whatsapp", "slack", "email"].map((id) => ({
            id,
            type: id,
            label: id === "email" ? "Email" : id[0]?.toUpperCase() + id.slice(1),
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
    });
  });
  await page.route("**/rpc/threads.list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.threads = body.result.threads.map((thread: { id: string }) =>
      thread.id === slack.id
        ? {
            ...thread,
            channel: { id: "slack", conversation: "slack-e2e" },
            unread: unread ? 3 : 0,
          }
        : thread.id === email.id
          ? {
              ...thread,
              channel: { id: "email", conversation: "email-e2e" },
              unread: unread ? 2 : 0,
            }
          : // Unread left by earlier specs on other channels would change the counts checked here.
            { ...thread, unread: 0 },
    );
    await route.fulfill({ response, json: body });
  });
  await open(page);
  const rows = page.locator(".channelsnav__shown .channelsnav__row");
  const ids = () => rows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-channel-id")));
  await expect(rows).toHaveCount(3);
  await expect.poll(ids).toEqual(["telegram", "discord", "whatsapp"]);
  const more = page.getByRole("button", { name: "2 canales más · 5 sin leer" });
  await expect(more).toBeVisible();
  await expect(more.locator(".apx-nav__count")).toHaveText("5");
  const fold = page.locator(".sidebar__toggle").filter({ hasText: "Canales" });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(fold.locator(".apx-nav__count")).toHaveText("5");
  await expect(fold).toHaveAccessibleName("Canales · 5 sin leer");
  await expect(rows).toHaveCount(0);
  await expect(more).toBeHidden();
  await page.reload();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "Plegar la barra", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(more.locator(".apx-nav__dot")).toBeVisible();
  await page.getByRole("button", { name: "Desplegar la barra", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await fold.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(rows).toHaveCount(3);
  await expect(fold.locator(".apx-nav__count")).toHaveCount(0);
  await page.getByRole("button", { name: "Plegar la barra", exact: true }).click();
  await expect(more.locator(".apx-nav__dot")).toBeVisible();
  await page.getByRole("button", { name: "Desplegar la barra", exact: true }).click();
  await page
    .locator('[data-channel-id="whatsapp"]')
    .dragTo(page.locator('[data-channel-id="telegram"]'), { targetPosition: { x: 20, y: 1 } });
  await expect.poll(ids).toEqual(["whatsapp", "telegram", "discord"]);
  await page.reload();
  await expect.poll(ids).toEqual(["whatsapp", "telegram", "discord"]);
  await more.click();
  const popup = page.locator('.apx-popover[aria-label="Canales"]');
  await expect(popup.getByRole("button", { name: /^Slack/ })).toBeVisible();
  await expect(popup.locator('[data-channel-id="slack"] .apx-nav__count')).toHaveText("3");
  await popup.getByRole("button", { name: /^Slack/ }).click();
  await expect(more).toHaveClass(/is-active/);
  await more.click();
  await popup.locator('[data-channel-id="email"]').hover();
  await popup.getByRole("button", { name: "Opciones de Email" }).click();
  await page.getByRole("menuitem", { name: "Mostrar primero" }).click();
  await expect.poll(ids).toEqual(["email", "whatsapp", "telegram"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "2 canales más · 3 sin leer" })).toBeVisible();
  unread = false;
  await page.reload();
  const cleared = page.getByRole("button", { name: "2 canales más", exact: true });
  await expect(cleared).toBeVisible();
  await expect(cleared.locator(".apx-nav__count")).toHaveCount(0);
  await expect.poll(ids).toEqual(["email", "whatsapp", "telegram"]);
});
