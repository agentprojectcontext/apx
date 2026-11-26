// The add box: an extension from elsewhere (a folder) is looked at under the source picker and added (nothing runs);
// its page opens, added, and Connect there asks for its key and shows its real tools. One with nothing to connect is
// ready on Add (DECISIONS.md#d-255).
import fs from "node:fs";
import path from "node:path";
import { expect, open, openExtension, openExtensionSettings, rpc, test, world } from "./kit.ts";

const SERVER = path.resolve(import.meta.dirname, "../../apps/core/src/mcp/fake-server.test-support.mjs");

async function folder(name: string, manifest: Record<string, unknown>, listing?: Record<string, unknown>) {
  const { dir } = await world.info();
  const root = path.join(dir, "add-box", name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "apx-extension.json"), JSON.stringify(manifest));
  if (listing) fs.writeFileSync(path.join(root, "apx-listing.json"), JSON.stringify(listing));
  return root;
}

async function fromFolder(page: import("@playwright/test").Page, root: string) {
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  await page.getByRole("button", { name: "Avanzado" }).click();
  await page.getByRole("button", { name: "Desde una carpeta" }).click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Carpeta de la extensión").fill(root);
  await box.getByRole("button", { name: "Revisar" }).click();
  return box;
}

test("from a folder: looked at, added without running, then connected with its key from its page", async ({ page }) => {
  const root = await folder(
    "northwind-notes",
    {
      id: "northwind-notes",
      name: "Northwind Notes",
      version: "1.0.0",
      description: "Notes for the CRM.",
      mcp: { notes: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://token" } } },
      secrets: [{ name: "token", label: "Notes token" }],
    },
    { schema: 2, summary: "Notes for the CRM.", tools: [{ name: "echo" }, { name: "token" }] },
  );
  const box = await fromFolder(page, root);
  await expect(box.getByText("Tuya")).toBeVisible();
  await expect(box.getByText("2 herramientas: echo y token.")).toBeVisible();
  await expect(box.getByText("Corre en tu compu desde que la conectes", { exact: true })).toBeVisible();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();

  // Added, still off: its page opens with Connect, and Connect asks for its key before it connects.
  await expect(box).toBeHidden();
  await expect(page.getByRole("heading", { name: "Northwind Notes", exact: true })).toBeVisible();
  await expect(page.getByText("Agregada. Conectala para que tus agentes la usen.")).toBeVisible();
  const added = (await rpc<{ extensions: Array<{ id: string; enabled: boolean }> }>("extensions.list")).extensions;
  expect(added.find((e) => e.id === "northwind-notes")?.enabled).toBe(false);
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Conectar Northwind Notes" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Conectar", exact: true })).toBeDisabled();
  await box.getByLabel("Notes token").fill("notes-e2e-token");
  await box.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Northwind Notes está lista" })).toBeVisible({ timeout: 30_000 });
  await expect(box.getByRole("status").filter({ hasText: "Conectada" })).toBeVisible();
  // Past adding it the card is folded under the action; opened, it lists the tools its server answered with.
  await box.getByRole("button", { name: "Ver qué trae" }).click();
  await expect(box.getByText(/herramientas: echo y token/)).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  await expect(box).toBeHidden();
});

test("one with nothing to connect is ready on Add", async ({ page }) => {
  const brief = path.resolve(import.meta.dirname, "../../examples/extensions/daily-brief");
  const box = await fromFolder(page, brief);
  await expect(box.getByText("Una rutina")).toBeVisible();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Daily brief está lista" })).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  await expect(box).toBeHidden();
});

test("an added one's page names the skills it brings", async ({ page }) => {
  const root = await folder("acme-playbooks", {
    id: "acme-playbooks",
    name: "Acme playbooks",
    version: "1.0.0",
    description: "Playbooks.",
    skills: "skills",
  });
  for (const s of ["campaign-strategist", "deals-crm"]) {
    fs.mkdirSync(path.join(root, "skills", s), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", s, "SKILL.md"), `---\nname: ${s}\ndescription: ${s}.\n---\nDo it.\n`);
  }
  const box = await fromFolder(page, root);
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Acme playbooks está lista" })).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  // Added, it is one of yours in the left column.
  await page.getByRole("button", { name: "Acme playbooks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Acme playbooks", exact: true })).toBeVisible();
  // Each skill by its name with its own line.
  await expect(page.getByRole("heading", { name: "Habilidades", exact: true })).toBeVisible();
  await expect(page.getByText("campaign-strategist", { exact: true })).toBeVisible();
  await expect(page.getByText("deals-crm.", { exact: true })).toBeVisible();
});

test("an agent added from an extension is archived when the extension is removed", async ({ page }) => {
  const root = await folder("acme-crew", {
    manifest: 2,
    id: "acme-crew",
    name: "Acme crew",
    version: "1.0.0",
    description: "Ready-made agents.",
    agents: [{ id: "planner", name: "Campaign planner", description: "Plans campaigns.", prompt: "Plan campaigns." }],
  });
  const box = await fromFolder(page, root);
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(box.getByRole("heading", { name: "Acme crew está lista" })).toBeVisible();
  await box.getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: "Acme crew", exact: true }).click();
  await page.getByText("Campaign planner", { exact: true }).click();
  await page.getByRole("button", { name: "Agregar agente" }).click();
  await expect(page.getByRole("button", { name: "En tu equipo" })).toBeDisabled();

  await page.getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitem", { name: "Quitar" }).click();
  const confirm = page.getByRole("dialog", { name: "¿Quitar Acme crew?" });
  await expect(confirm.getByText(/se archivan los agentes que agregaste desde ella: Campaign planner/)).toBeVisible();
  await confirm.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(confirm).toBeHidden();
  const archived = (await rpc<{ agents: Array<{ id: string }> }>("agents.archived")).agents;
  expect(archived.map((a) => a.id)).toContain("campaign-planner");
});

test("its settings keep each part apart: the keys, reading it again and trying it", async ({ page }, info) => {
  const root = await folder("northwind-desk", {
    id: "northwind-desk",
    name: "Northwind Desk",
    version: "1.0.0",
    description: "The help desk.",
    mcp: { desk: { command: process.execPath, args: [SERVER], env: { DESK_TOKEN: "secret://token" } } },
    secrets: [{ name: "token", label: "Desk token" }],
  });
  await rpc("extensions.install", { path: root });
  await rpc("extensions.set_secret", { id: "northwind-desk", name: "token", value: "desk-e2e-token" });
  await rpc("extensions.enable", { id: "northwind-desk", enabled: true });
  await open(page);
  await openExtension(page, "Northwind Desk");
  const dialog = await openExtensionSettings(page);
  const parts = dialog.locator(".mkt-settings > section");
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0)).toContainText("Sus claves");
  await expect(parts.nth(1)).toContainText(root);
  await expect(parts.nth(2).getByRole("button", { name: "Probar" })).toBeVisible();
  // The folder's path wraps: nothing in the dialog scrolls sideways.
  const body = dialog.locator(".mkt-settings");
  expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.screenshot({ path: info.outputPath("extension-settings.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(parts.nth(0).getByRole("button", { name: "Borrar" })).toBeInViewport({ ratio: 1 });
  await dialog.screenshot({ path: info.outputPath("extension-settings-phone.png") });
});

test("a server added by its address is one of your extensions, not a plain server in Resources", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  await page.getByRole("button", { name: "Agregar", exact: true }).first().click();
  await page.getByRole("menuitem", { name: /Desde una dirección/ }).click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Dirección").fill("https://mcp.northwind.example/mcp");
  await box.getByRole("button", { name: "Revisar" }).click();
  await box.getByRole("button", { name: "Agregar", exact: true }).click();
  // The address answers nobody here; it stays added as the owner's own connector, to check and try again.
  await expect
    .poll(async () =>
      (await rpc<{ extensions: Array<{ source: string; mcp: string[] }> }>("extensions.list")).extensions.some(
        (e) => e.source.includes("connectors") && e.mcp.length === 1,
      ),
    )
    .toBe(true);
  const servers = (await rpc<{ servers: Array<{ name: string; definition?: unknown }> }>("mcp.list")).servers;
  expect(servers.some((s) => s.name.startsWith("mcp-northwind") && s.definition)).toBe(false);
});

test("Explore says what each one is, filters by kind and keeps the channels together", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "Marketplace", exact: true }).first().click();
  const filters = page.getByRole("radiogroup", { name: "Qué trae" });
  await expect(filters.getByRole("radio", { name: /^Canales/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Incluidas con APX" })).toHaveCount(0);
  const channels = page.locator(".mkt-section", { has: page.getByRole("heading", { name: "Canales", exact: true }) });
  await expect(channels.getByText("Canal · Creada por APX").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("explore-kinds.png"), fullPage: true });
  await filters.getByRole("radio", { name: /^Canales/ }).click();
  await expect(page.getByText("Conector · Creada por APX")).toHaveCount(0);
  await expect(page.getByText("Canal · Creada por APX").first()).toBeVisible();
});
