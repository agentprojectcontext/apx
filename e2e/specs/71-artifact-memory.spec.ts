import type { Frame, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** A kit page that keeps a reading in its store and a row per click in its database. */
const page = (live: boolean) => `${live ? '<meta name="apx-live" content="on">' : ""}
<script src="/_apx/kit@1.js"></script>
<main class="ax-page"><button id="save" class="ax-btn">Save</button><output id="out">loading</output></main>
<script>
const out = document.getElementById("out");
async function show() {
  const reading = await APX.store.get("reading");
  const rows = await APX.db.query("SELECT n FROM marks ORDER BY n");
  out.textContent = (reading ?? "none") + "|" + rows.map((r) => r.n).join(",");
}
APX.db.exec("CREATE TABLE IF NOT EXISTS marks (n INTEGER)").then(show);
document.getElementById("save").onclick = async () => {
  await APX.store.set("reading", "r1");
  await APX.db.exec("INSERT INTO marks (n) VALUES (?)", [7]);
  show();
};
</script>`;

const frames = (p: Page): Frame[] => p.frames().filter((f) => f.url().startsWith("about:srcdoc"));

test("an artifact's store and database survive a reload", async ({ page: p }) => {
  await rpc("setup.finish", {});
  const live = await rpc<{ id: string }>("surfaces.show", {
    name: "memory-live",
    title: "Live",
    html: page(true),
    app: true,
  });

  await open(p, `#app=${live.id}`);
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("none|");
  await frames(p)[0]?.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("r1|7");
  await p.reload();
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("r1|7");
  const memory = await rpc<{ store: { keys: string[] }; db: { tables: { name: string; rows: number }[] } }>(
    "surfaces.memory",
    { surface: live.id },
  );
  expect(memory.store.keys).toEqual(["reading"]);
  expect(memory.db.tables).toContainEqual({ name: "marks", rows: 1 });
});

test("an opened artifact keeps running as it was left while the owner goes elsewhere, pinned or not, until closed", async ({
  page: p,
}) => {
  // Wide enough for the full sidebar: the rail shows only icons, without the pin and close beside them.
  await p.setViewportSize({ width: 1600, height: 900 });
  await rpc("setup.finish", {});
  const one = await rpc<{ id: string }>("surfaces.show", {
    name: "dock-one",
    title: "Dock one",
    html: page(false),
    app: true,
  });
  const two = await rpc<{ id: string }>("surfaces.show", {
    name: "dock-two",
    title: "Dock two",
    html: page(false),
    app: true,
  });
  const marked = () =>
    Promise.all(frames(p).map((f) => f.evaluate(() => (window as unknown as { mark?: string }).mark === "left"))).then(
      (all) => all.filter(Boolean).length,
    );

  await open(p, `#app=${one.id}`);
  await expect.poll(() => frames(p).length).toBe(1);
  await frames(p)[0]?.evaluate(() => {
    (window as unknown as { mark: string }).mark = "left";
  });
  // Another app, then the inbox: the first one is still the same page when the owner comes back.
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, two.id);
  await expect.poll(() => frames(p).length).toBe(2);
  await p.evaluate(() => {
    location.hash = "";
  });
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, one.id);
  await expect.poll(marked).toBe(1);
  await expect(p.locator(".navitem__running")).toHaveCount(2);

  // Closed, it is gone: opened again, it starts over from its memory.
  await p.locator(".appscreen__head").getByRole("button", { name: "Cerrar app" }).click();
  await expect(p.locator(".navitem__running")).toHaveCount(1);
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, one.id);
  await expect.poll(() => frames(p).length).toBe(2);
  await expect.poll(marked).toBe(0);

  // A widget opened full screen keeps running too, listed under the pinned apps with its pin until closed.
  const view = await rpc<{ id: string }>("surfaces.show", {
    name: "dock-view",
    title: "Dock view",
    html: page(false),
    app: false,
  });
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, view.id);
  await expect.poll(() => frames(p).length).toBe(3);
  await p.evaluate(() => {
    location.hash = "";
  });
  await expect(p.locator(".appsdock__loose")).toHaveCount(1);
  await expect.poll(() => frames(p).length).toBe(3);
  await p.locator(".appsdock__loose").getByRole("button", { name: "Fijar en Apps" }).click();
  await expect(p.locator(".appsdock__loose")).toHaveCount(0);
  await expect(p.locator(".navitem__running")).toHaveCount(3);

  // Unpinned from Apps, a running app keeps running under the line; its close there ends it.
  await rpc("surfaces.update", { surface: two.id, app: false });
  await expect(p.locator(".appsdock__loose")).toHaveCount(1);
  await expect.poll(() => frames(p).length).toBe(3);
  await p.locator(".appsdock__loose").hover();
  await p.locator(".appsdock__loose").getByRole("button", { name: "Cerrar app" }).click();
  await expect(p.locator(".appsdock__loose")).toHaveCount(0);
  await expect.poll(() => frames(p).length).toBe(2);
});

test("an .apxart file is shown for what it is before it installs, pinned and with its data as the owner chooses", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  const made = await rpc<{ id: string }>("surfaces.show", {
    name: "install-me",
    title: "Install me",
    html: page(false),
    app: false,
  });
  await rpc("surfaces.store_set", { surface: made.id, patch: { reading: "r9" } });
  const bundle = await rpc<object>("surfaces.export", { surface: made.id, memory: true });

  await open(p);
  await p.getByRole("button", { name: "Instalar artefacto" }).first().click();
  const dialog = p.getByRole("dialog", { name: "Instalar un artefacto" });
  await expect(dialog.getByRole("button", { name: "Instalar", exact: true })).toBeDisabled();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "install-me.apxart",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(JSON.stringify(bundle)),
  });
  // What it is, before anything is written: a widget, bringing its cache, with a name already taken here.
  await expect(dialog.getByText("Install me")).toBeVisible();
  await expect(dialog.getByText("Widget", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Trae la última lectura guardada")).toBeVisible();
  await expect(dialog.getByText(/Ya hay un artefacto llamado install-me/)).toBeVisible();
  await dialog.getByRole("switch", { name: "Fijar en Apps" }).click();
  await dialog.getByRole("button", { name: "Instalar", exact: true }).click();
  await expect(dialog).toBeHidden();

  const { surfaces } = await rpc<{ surfaces: { id: string; name: string; app: boolean }[] }>("surfaces.list");
  const installed = surfaces.find((s) => s.name === "install-me-2");
  expect(installed?.app).toBe(true);
  const memory = await rpc<{ store: { keys: string[] } }>("surfaces.memory", { surface: installed?.id ?? "" });
  expect(memory.store.keys).toEqual(["reading"]);

  // Its properties say it came from a file, and from which version.
  await p.locator(".appsdock__icon").first().click({ button: "right" });
  await p.getByRole("menuitem", { name: "Propiedades…" }).click();
  const props = p.getByRole("dialog", { name: /Install me/ });
  await expect(props.getByText("Instalado desde un archivo")).toBeVisible();
  await expect(props.getByText("Su versión entonces")).toBeVisible();
});

/** Lets `files` go over `selector`, the way a drag from the system ends: a drop event carrying them. */
async function dropFiles(p: Page, selector: string, files: { name: string; text: string }[]) {
  await p
    .locator(selector)
    .first()
    .evaluate((el, files) => {
      const data = new DataTransfer();
      for (const f of files) data.items.add(new File([f.text], f.name));
      el.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    }, files);
}

test("an .apxart dropped anywhere on the window opens the install dialog with it, never as a chat attachment", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  const made = await rpc<{ id: string }>("surfaces.show", { name: "dropped", title: "Dropped", html: page(false) });
  const bundle = JSON.stringify(await rpc<object>("surfaces.export", { surface: made.id, memory: false }));

  await open(p);
  // On the chat's composer, which takes other files as attachments.
  await dropFiles(p, "textarea", [{ name: "dropped.apxart", text: bundle }]);
  const dialog = p.getByRole("dialog", { name: "Instalar un artefacto" });
  await expect(dialog.getByText("Dropped", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Instalar", exact: true })).toBeEnabled();
  await expect(p.locator(".attchip")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();

  // Anywhere else too; an app or extension file says it does not install from a file yet.
  await dropFiles(p, "body", [{ name: "tools.apxext", text: "{}" }]);
  await expect(p.getByText(/tools\.apxext es una app o extensión de APX/)).toBeVisible();
  await expect(dialog).toBeHidden();
  await dropFiles(p, "body", [{ name: "dropped.apxart", text: bundle }]);
  await expect(dialog.getByText("Dropped", { exact: true })).toBeVisible();
});

test("Create an artifact opens a new chat with the super-agent, its first words ready to finish", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  await open(p);
  await p.getByRole("button", { name: "Abrir un artefacto" }).click();
  await p.getByRole("button", { name: /Crear un artefacto/ }).click();
  const composer = p.getByRole("textbox", { name: /Escribile a/ }).last();
  await expect(composer).toHaveValue("Quiero crear un artefacto: ");
  const { threads } = await rpc<{ threads: { title?: string; agent_id?: string }[] }>("threads.list", {});
  expect(threads.some((t) => t.title === "Artefacto nuevo")).toBe(true);
});
