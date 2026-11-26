import type { Page } from "@playwright/test";
import type { DiscoveryStatus, Routine } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test, world } from "./kit.ts";

async function prepareResearch() {
  await rpc("setup.finish");
  const {
    indexed: _indexed,
    total: _total,
    embedder: _embedder,
    ...memory
  } = await rpc<
    import("../../packages/protocol/src/index.ts").MemorySettings & {
      indexed: number;
      total: number;
      embedder?: string;
    }
  >("memory.settings");
  await rpc("memory.set_settings", { ...memory, aux_model: "custom/fake-1" });
  const initial = await rpc<DiscoveryStatus>("discovery.settings");
  await rpc("discovery.configure", {
    ...initial.settings,
    enabled: false,
    sources: [],
    interests: [],
    location: "",
    project_context: false,
    project_websites: false,
    interest_news: false,
    report_routine: null,
  });
  await world.clock("2099-05-01T08:00:00.000Z");
  const report = await rpc<Routine>("routines.set", {
    name: "Morning report",
    agent: "superagent",
    schedule: { kind: "manual" },
    prompt: "Summarize what matters today.",
  });
  const owner = await rpc<{ timezone: string }>("owner.get");
  await rpc("owner.set", { timezone: "America/Argentina/Buenos_Aires" });
  return { initial, memory, report, zone: owner.timezone };
}

async function undoAfterCacheClear(page: Page, en: boolean) {
  expect((await rpc<DiscoveryStatus>("discovery.settings")).muted_topics).toHaveLength(1);
  await page.getByRole("button", { name: en ? "Refresh" : "Actualizar", exact: true }).click();
  await page.getByText(en ? "Muted topics" : "Temas silenciados", { exact: true }).click();
  await page.getByRole("button", { name: en ? /^Unmute topic:/ : /^Dejar de silenciar:/ }).click();
  await expect.poll(async () => (await rpc<DiscoveryStatus>("discovery.settings")).muted_topics.length).toBe(0);
}
async function restoreMuted(initial: DiscoveryStatus) {
  const current = await rpc<DiscoveryStatus>("discovery.settings");
  for (const topic of current.muted_topics)
    if (!initial.muted_topics.some((item) => item.id === topic.id))
      await rpc("discovery.feedback", { finding: topic.id, feedback: "unmute" });
}

async function checkInterestControl(page: Page, en: boolean) {
  const input = page.getByRole("textbox", { name: en ? "Interests" : "Intereses", exact: true });
  await input.fill("Portable exports");
  await input.press("Enter");
  const remove = page.getByRole("button", {
    name: en ? "Remove Portable exports" : "Quitar Portable exports",
    exact: true,
  });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
  // Adding doesn't depend on knowing Enter: a button shows while a topic is typed.
  await input.fill("Open data");
  await page.getByRole("button", { name: en ? "Add" : "Agregar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: en ? "Remove Open data" : "Quitar Open data", exact: true }),
  ).toBeVisible();
}
async function recoverConflict(page: Page, en: boolean) {
  const reload = en ? "Reload" : "Recargar";
  const discard = en ? "Reload and lose your unsaved changes?" : "¿Recargar y perder tus cambios sin guardar?";
  await page.getByRole("button", { name: reload, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: discard, exact: true });
  await dialog
    .locator(".apx-dialog__footer")
    .getByRole("button", { name: en ? "Cancel" : "Cancelar", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const place = page.getByRole("textbox", {
    name: en ? "City or region · optional" : "Ciudad o región · opcional",
    exact: true,
  });
  await expect(place).toHaveValue("Unsaved region");
  await page.getByRole("button", { name: reload, exact: true }).click();
  await dialog.getByRole("button", { name: reload, exact: true }).click();
  await expect(place).toHaveValue("Changed elsewhere");
  await expect(page.getByRole("alert")).toHaveCount(0);
}
async function checkRatings(page: Page, en: boolean) {
  const region = page.getByRole("region", { name: en ? "Worth a look" : "Para tener en cuenta" });
  const useful = en ? "Useful" : "Útil";
  const notUseful = en ? "Not useful" : "No útil";
  await region.getByRole("button", { name: useful, exact: true }).click();
  await expect(region.getByRole("button", { name: useful, exact: true, pressed: true })).toBeVisible();
  expect((await rpc<DiscoveryStatus>("discovery.settings")).findings[0]?.feedback).toBe("useful");
  await region.getByRole("button", { name: notUseful, exact: true }).click();
  await expect(region.getByRole("button", { name: notUseful, exact: true, pressed: true })).toBeVisible();
  await expect(region.getByRole("button", { name: useful, exact: true, pressed: false })).toBeVisible();
  expect((await rpc<DiscoveryStatus>("discovery.settings")).findings[0]?.feedback).toBe("not_useful");
}

for (const language of ["en", "es"] as const)
  for (const width of [1280, 390]) {
    test(`investigación contextual: configuración, evidencia, feedback y errores (${language}, ${width})`, async ({
      page,
    }, info) => {
      const { initial, memory, report, zone } = await prepareResearch();
      const en = language === "en";
      const title = en ? "Research" : "Investigación";
      const save = en ? "Save changes" : "Guardar cambios";
      const enabled = en
        ? "Look for news on my projects and interests"
        : "Buscar novedades de mis proyectos e intereses";
      try {
        await page.setViewportSize({ width, height: width === 390 ? 780 : 1000 });
        await page.addInitScript(
          (lang) => localStorage.setItem("apx.prefs", JSON.stringify({ language: lang })),
          language,
        );
        const chunks: string[] = [];
        page.on("request", (request) => {
          if (/\/discovery-(?:en|es)-[^/]+\.js(?:\?|$)/.test(request.url())) chunks.push(request.url());
        });
        await open(page);
        await page.getByRole("button", { name: en ? /^Account/ : /^Cuenta/ }).click();
        await page.getByRole("menuitem", { name: en ? /^Settings(?! wizard)/ : /^Configuración(?! inicial)/ }).click();
        expect(chunks).toEqual([]);
        await page.getByRole("dialog").getByRole("button", { name: title, exact: true }).click();
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        expect(chunks).toHaveLength(1);
        await expect(page.getByRole("switch", { name: enabled })).not.toBeChecked();
        // Off, the setup is out of the way; the switch applies at once, like every switch in Settings.
        await expect(page.getByRole("textbox", { name: en ? "Interests" : "Intereses", exact: true })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath("off.png"), fullPage: true });
        await page.getByRole("switch", { name: enabled }).click();
        await expect.poll(async () => (await rpc<DiscoveryStatus>("discovery.settings")).settings.enabled).toBe(true);
        await expect(page.getByRole("button", { name: save, exact: true })).toHaveCount(0);
        // The research follows the profile's time zone instead of asking for its own.
        await expect(
          page.getByText(
            en ? "Uses your profile's: Argentina / Buenos Aires." : "Se usa la de tu perfil: Argentina / Buenos Aires.",
            { exact: true },
          ),
        ).toBeVisible();
        await page.getByRole("combobox", { name: en ? "Usual report" : "Informe habitual" }).click();
        await page.getByRole("option", { name: /^Morning report/ }).click();
        await expect(page.getByText(en ? "You have unsaved changes." : "Tenés cambios sin guardar.")).toBeVisible();
        await checkInterestControl(page, en);
        await page.locator(".config__content").evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath("on.png"), fullPage: true });
        await page.getByText(en ? "More pages to read" : "Otras páginas para leer", { exact: true }).click();
        await page.getByRole("button", { name: en ? "Add pages" : "Agregar páginas", exact: true }).click();
        await page.getByRole("textbox", { name: en ? "Name" : "Nombre", exact: true }).fill("Acme release notes");
        await page
          .getByRole("textbox", {
            name: en ? "Page addresses · one per line" : "Direcciones de las páginas · una por línea",
            exact: true,
          })
          .fill("https://research.example/news");
        const place = page.getByRole("textbox", {
          name: en ? "City or region · optional" : "Ciudad o región · opcional",
        });
        await place.fill("Example region");
        await page.screenshot({ path: info.outputPath("unsaved.png"), fullPage: true });
        await page.getByRole("button", { name: save, exact: true }).click();
        await expect(
          page.getByRole("status").filter({ hasText: en ? "Changes saved" : "Cambios guardados" }),
        ).toBeVisible();
        const config = await rpc<DiscoveryStatus>("discovery.settings");
        expect(config.settings.enabled).toBe(true);
        expect(config.settings.report_routine).toBe(report.id);
        expect(config.settings.interests).toEqual(["Open data"]);
        expect(config.settings.sources[0]?.pages).toEqual(["https://research.example/news"]);
        await world.clock("2099-05-01T08:02:00.000Z");
        await expect
          .poll(async () => {
            const status = await rpc<DiscoveryStatus>("discovery.settings");
            return {
              available: status.available,
              state: status.state,
              count: status.findings.length,
              inaccessible: status.inaccessible,
            };
          })
          .toMatchObject({ available: true, state: "completed", count: 1 });
        const finding = (await rpc<DiscoveryStatus>("discovery.settings")).findings[0]?.id;
        await page.getByRole("button", { name: en ? "Refresh" : "Actualizar", exact: true }).click();
        const findings = page.getByRole("region", { name: en ? "Worth a look" : "Para tener en cuenta" });
        await expect(findings.getByRole("link", { name: "Acme release notes" })).toHaveAttribute(
          "href",
          "https://research.example/news",
        );
        await expect(
          findings.getByText("Acme now supports a documented portable export format.", { exact: true }),
        ).toBeVisible();
        await findings.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath("finding.png"), fullPage: true });
        await checkRatings(page, en);
        await page.screenshot({ path: info.outputPath("feedback.png"), fullPage: true });
        await findings.getByRole("button", { name: en ? "Mute topic" : "Silenciar tema", exact: true }).click();
        const confirm = page.getByRole("dialog", {
          name: en ? "Mute this topic?" : "¿Silenciar este tema?",
          exact: true,
        });
        await confirm.getByRole("button", { name: en ? "Mute topic" : "Silenciar tema", exact: true }).click();
        await expect(confirm).not.toBeVisible();
        expect((await rpc<DiscoveryStatus>("discovery.settings")).findings[0]?.feedback).toBe("mute");
        await findings.getByRole("button", { name: en ? "Unmute topic" : "Dejar de silenciar", exact: true }).click();
        await expect
          .poll(async () => (await rpc<DiscoveryStatus>("discovery.settings")).findings[0]?.feedback)
          .toBeUndefined();
        await place.fill("Unsaved region");
        await page.route("**/rpc/discovery.configure", (route) =>
          route.fulfill({ json: { ok: false, error: { code: "internal", message: "Fixture save failure" } } }),
        );
        await page.getByRole("button", { name: save, exact: true }).click();
        await expect(page.getByRole("alert")).toContainText(en ? "Couldn't save" : "No se pudo guardar");
        await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
        await expect(place).toHaveValue("Unsaved region");
        await page.screenshot({ path: info.outputPath("save-error.png"), fullPage: true });
        await page.unroute("**/rpc/discovery.configure");
        await rpc("discovery.feedback", { finding, feedback: "mute" });
        await rpc("discovery.configure", { location: "Changed elsewhere" });
        await page.route("**/rpc/discovery.configure", async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(409);
          await route.fulfill({ response, status: 200 });
        });
        await page.getByRole("button", { name: save, exact: true }).click();
        await expect(page.getByRole("alert")).toContainText(en ? "changed somewhere else" : "cambió desde otro lugar");
        await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
        await expect(place).toHaveValue("Unsaved region");
        await page.screenshot({ path: info.outputPath("conflict.png"), fullPage: true });
        await recoverConflict(page, en);
        await undoAfterCacheClear(page, en);
        const content = page.locator(".config__content");
        const overflow = await content.evaluate((element) => {
          const edge = element.getBoundingClientRect().right;
          return [...element.querySelectorAll("*")]
            .filter((child) => child.getBoundingClientRect().right > edge + 1)
            .slice(0, 10)
            .map((child) => ({
              tag: child.tagName,
              class: child.className,
              width: child.getBoundingClientRect().width,
            }));
        });
        expect(
          await content.evaluate((element) => element.scrollWidth <= element.clientWidth),
          JSON.stringify(overflow),
        ).toBe(true);
        await page.screenshot({ path: info.outputPath("unmuted-after-cache-clear.png"), fullPage: true });
      } finally {
        await restoreMuted(initial);
        await rpc("discovery.configure", { ...initial.settings, enabled: false });
        await rpc("memory.set_settings", memory);
        await rpc("routines.remove", { routine: report.id });
        await rpc("owner.set", { timezone: zone });
        await world.clock(null);
      }
    });
  }
