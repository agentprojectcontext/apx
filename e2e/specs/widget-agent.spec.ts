import type { Agent, Message, SurfaceSummary, Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

for (const lang of ["en", "es"] as const)
  for (const width of [1280, 390]) {
    test(`edit a widget with another project agent, ${lang} at ${width}px, preserving memory and drafts`, async ({
      page,
    }, info) => {
      const en = lang === "en";
      const copy = {
        ask: en ? "Ask for changes" : "Pedir cambios",
        pick: en ? "Edit with" : "Editar con",
        search: en ? "Search an agent" : "Buscá un agente",
        empty: en ? "No results" : "Sin resultados",
        confirm: en ? "Open new chat" : "Abrir chat nuevo",
        cancel: en ? "Keep editing" : "Seguir editando",
        reset: en ? "New session for this widget" : "Nueva sesión para este widget",
      };
      await page.addInitScript((language) => {
        if (window !== window.top) return;
        const prefs = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
        localStorage.setItem("apx.prefs", JSON.stringify({ ...prefs, language }));
      }, lang);
      await rpc("setup.finish", {});
      const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: `Acme ${lang} ${width}` });
      const { project: other } = await rpc<{ project: { id: string } }>("projects.create", {
        name: `Northwind ${lang} ${width}`,
      });
      const creator = await rpc<Agent>("agents.create", { name: "Builder", slug: "builder", project_id: project.id });
      const editor = await rpc<Agent>("agents.create", { name: "Reviewer", slug: "reviewer", project_id: project.id });
      await rpc("agents.create", { name: "Outside editor", slug: "outside", project_id: other.id });
      const original = await rpc<Thread>("threads.create", {
        kind: "loose",
        agent_id: creator.id,
        project_id: project.id,
      });
      await rpc("threads.send", { thread: original.id, text: "show a widget" });
      let surface: SurfaceSummary | undefined;
      await expect
        .poll(async () => {
          surface = (await rpc<{ surfaces: SurfaceSummary[] }>("surfaces.list", {})).surfaces.find(
            (s) => s.project_id === project.id,
          );
          return surface?.id;
        })
        .toBeTruthy();
      if (!surface) throw new Error("widget not created");
      const made = surface;
      await rpc("surfaces.store_set", { surface: made.id, patch: { reading: "saved value" } });
      const memory = await rpc("surfaces.memory", { surface: made.id });
      await page.setViewportSize({ width, height: 860 });
      await open(page, `#app=${made.id}`);
      await page.locator(".appscreen__head").getByRole("button", { name: copy.ask, exact: true }).click();
      const drawer = page.locator(".widgetchat");
      const picker = drawer.getByRole("combobox", { name: copy.pick, exact: true });
      const composer = drawer.getByRole("textbox");
      await expect(picker).toContainText("Builder");
      await picker.click();
      await expect(page.getByRole("option", { name: /Reviewer/ })).toBeVisible();
      await expect(page.getByRole("option", { name: /Outside editor/ })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("agents.png") });
      await page.route("**/rpc/threads.create", (route) =>
        route.fulfill({ json: { ok: false, error: { code: "conflict", message: "Try again" } } }),
      );
      await page.getByRole("option", { name: /Reviewer/ }).click();
      await expect(page.getByText(en ? /Could not open the chat\./ : /No se pudo abrir el chat\./)).toBeVisible();
      await expect(page.getByText(/Try again/)).toHaveCount(0);
      await expect(picker).toContainText("Builder");
      await page.screenshot({ path: info.outputPath("error.png") });
      await page
        .locator(".toasts")
        .getByRole("button", { name: en ? "Close" : "Cerrar", exact: true })
        .click();
      expect(await rpc("surfaces.memory", { surface: made.id })).toEqual(memory);
      await page.unroute("**/rpc/threads.create");
      await composer.fill("Keep this unsent draft");
      await picker.click();
      const search = page.getByRole("combobox", { name: copy.search });
      await search.fill("No such person");
      await expect(page.getByRole("option")).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: copy.empty })).toBeVisible();
      await page.screenshot({ path: info.outputPath("empty.png") });
      await search.fill("Reviewer");
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(page.getByRole("dialog", { name: copy.pick, exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: copy.cancel, exact: true }).click();
      await expect(composer).toHaveValue("Keep this unsent draft");
      await picker.click();
      await page.getByRole("option", { name: /Reviewer/ }).click();
      await page.screenshot({ path: info.outputPath("draft.png") });
      await page.getByRole("button", { name: copy.confirm, exact: true }).click();
      await expect(picker).toContainText("Reviewer");
      await expect(composer).toHaveValue(new RegExp(made.title));
      await expect(composer).not.toHaveValue(new RegExp(made.name));
      await expect(drawer.locator(".ctxrefs__label")).toHaveText(made.title);
      await page.screenshot({ path: info.outputPath("editor.png") });
      await page.reload();
      await page.locator(".appscreen__head").getByRole("button", { name: copy.ask, exact: true }).click();
      await expect(picker).toContainText("Reviewer");
      await expect(drawer.locator(".ctxrefs__label")).toHaveText(made.title);
      const { threads } = await rpc<{ threads: Thread[] }>("threads.list", { project_id: project.id });
      const editing = threads.find((t) => t.agent_ids[0] === editor.id);
      expect(editing?.project_id).toBe(made.project_id);
      expect(editing?.id).not.toBe(original.id);
      expect(threads.some((t) => t.id === original.id)).toBe(true);
      expect(await rpc("surfaces.memory", { surface: made.id })).toEqual(memory);
      await composer.fill("show a widget");
      await composer.press("Enter");
      await expect
        .poll(async () => {
          const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: editing?.id });
          return messages.some((m) => m.parts.some((p) => p.type === "surface" && p.surface_id === made.id));
        })
        .toBe(true);
      const { surfaces } = await rpc<{ surfaces: SurfaceSummary[] }>("surfaces.list", {});
      const same = surfaces.filter((s) => s.project_id === project.id);
      expect(same).toHaveLength(1);
      expect(same[0]).toMatchObject({ id: made.id, name: made.name, project_id: made.project_id });
      expect(await rpc("surfaces.memory", { surface: made.id })).toEqual(memory);
      await drawer.getByRole("button", { name: copy.reset }).click();
      await expect(picker).toContainText("Reviewer");
      await expect(composer).toHaveValue(new RegExp(made.title));
      await drawer.getByRole("button", { name: en ? "Close" : "Cerrar", exact: true }).click();
      await open(page, `#thread=${original.id}`);
      await expect(
        page.getByRole("textbox", { name: en ? "Message Builder…" : "Escribile a Builder…", exact: true }),
      ).toHaveValue("Keep this unsent draft");
    });
  }
