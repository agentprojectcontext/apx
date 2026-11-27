// Adding a catalog: the dialog closes at once and its row in Advanced says how it is read; once read it lists what it
// has, and one that can't be read says so with a way to try again.
import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

async function catalogFolder() {
  const { dir } = await world.info();
  const root = path.join(dir, "catalog-read", "acme-plugins");
  const put = (rel: string, data: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  put(
    ".claude-plugin/marketplace.json",
    JSON.stringify({
      name: "Acme plugins",
      owner: { name: "Acme" },
      plugins: [{ name: "notes", description: "Notes for agents.", source: "./notes" }],
    }),
  );
  put("notes/.claude-plugin/plugin.json", JSON.stringify({ name: "notes", version: "0.4.0", license: "MIT" }));
  put("notes/skills/notes/SKILL.md", "---\nname: notes\ndescription: Notes.\n---\nTake notes.\n");
  return root;
}

async function addCatalog(page: import("@playwright/test").Page, source: string) {
  await page.getByRole("button", { name: "Agregar catálogo" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Repositorio o dirección").fill(source);
  await dialog.getByRole("button", { name: "Agregar", exact: true }).last().click();
  await expect(dialog).toBeHidden();
}

test("a catalog is read in the background: its row lists it once read, or says it could not be read", async ({
  page,
}) => {
  const root = await catalogFolder();
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  await page.getByRole("button", { name: "Avanzado" }).click();

  await addCatalog(page, root);
  const row = page.locator(".mkt-catalog").filter({ hasText: "Acme plugins" });
  await expect(row.getByText(/1 extensiones?/)).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("button", { name: "Ver en Explorar" })).toBeVisible();

  await addCatalog(page, path.join(root, "missing"));
  const bad = page.locator(".mkt-catalog").filter({ hasText: "missing" });
  await expect(bad.getByText("No se pudo leer")).toBeVisible({ timeout: 30_000 });
  await expect(bad.getByRole("button", { name: "Intentar de nuevo" })).toBeVisible();
  await bad.getByRole("button", { name: "Quitar" }).click();
  await page
    .getByRole("dialog", { name: "¿Quitar el catálogo missing?" })
    .getByRole("button", { name: "Quitar" })
    .click();
  await expect(bad).toBeHidden();

  const before = await rpc("extensions.list");
  const servers = await rpc("mcp.list");
  const channels = await rpc("channels.list");
  await row.getByRole("button", { name: "Ver en Explorar" }).click();
  const notes = page.locator(".apx-catalogrow").filter({ hasText: "notes" }).first();
  await notes.getByRole("button", { name: "Ver detalle", exact: true }).click();
  await expect(page.getByRole("heading", { name: "notes", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Agregar", exact: true });
  await expect(add).toBeVisible();
  const scope = page.locator(".mkt-page__tagline");
  await expect(scope).toHaveText("Notes for agents.");
  await expect
    .poll(async () => {
      const description = await scope.boundingBox();
      const action = await add.boundingBox();
      return !!description && !!action && action.y >= description.y + description.height;
    })
    .toBe(true);
  expect(await rpc("extensions.list")).toEqual(before);
  expect(await rpc("mcp.list")).toEqual(servers);
  expect(await rpc("channels.list")).toEqual(channels);
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect.poll(() => rpc("extensions.list")).not.toEqual(before);
  await expect(page.getByRole("button", { name: "Agregar", exact: true })).toHaveCount(0);
});

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`unread catalog details state missing contents without promising a preview, ${language} ${width}`, async ({
      page,
    }) => {
      const { dir } = await world.info();
      const root = path.join(dir, "unread-catalog");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        path.join(root, "index.json"),
        JSON.stringify({
          name: "Acme catalog",
          entries: [
            {
              id: "acme-unread",
              name: "Acme unread",
              description: "Read-only access to notes.",
              versions: [{ version: "1.0.0", archive: { url: "https://extensions.example.test/unread.apxext" } }],
            },
          ],
        }),
      );
      await rpc("extensions.catalog_add", { source: root });
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
      await open(page);
      await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
      const row = page.locator(".apx-catalogrow").filter({ hasText: "Acme unread" }).first();
      await row.getByRole("button", { name: language === "en" ? "View details" : "Ver detalle", exact: true }).click();
      const add = page.getByRole("button", { name: language === "en" ? "Add" : "Agregar", exact: true });
      await expect(add).toBeVisible();
      await expect(
        page.getByText(
          language === "en" ? "This catalog doesn't list what it includes." : "Este catálogo no detalla qué incluye.",
          { exact: true },
        ),
      ).toBeVisible();
      const scope = page.locator(".mkt-page__tagline");
      await expect(scope).toHaveText("Read-only access to notes.");
      await expect
        .poll(async () => {
          const description = await scope.boundingBox();
          const action = await add.boundingBox();
          return !!description && !!action && action.y >= description.y + description.height;
        })
        .toBe(true);
      await expect(page.getByText(/before adding anything|antes de sumar nada/)).toHaveCount(0);
      const installed = await rpc<{ extensions: Array<{ id: string }> }>("extensions.list");
      expect(installed.extensions.some((entry) => entry.id === "acme-unread")).toBe(false);
      await page.screenshot({ path: test.info().outputPath("catalog-detail.png"), fullPage: true });
    });
  }
}
