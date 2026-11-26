import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

for (const width of [1280, 390]) {
  test(`research: projects are ticked in a menu and shown as chips, and a routine can be made from there (${width})`, async ({
    page,
  }, info) => {
    const env = await startCore({ port: 0, llm: scriptedLlm(() => say("ok")) });
    try {
      await env.client.call("setup.finish", {});
      for (const name of ["Acme web", "Northwind app", "Contoso docs", "Fabrikam shop"])
        await env.client.call("projects.create", { name });
      await env.client.call("discovery.configure", { enabled: true });
      await page.setViewportSize({ width, height: width === 390 ? 780 : 900 });
      await page.goto(env.core.url);
      await page.getByRole("button", { name: /^Cuenta/ }).click();
      await page.getByRole("menuitem", { name: /^Configuración(?! inicial)/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Investigación", exact: true }).click();

      // Automatic is the default: urgent things at once, the rest in a morning summary.
      await expect(page.getByRole("radio", { name: "Automático", checked: true })).toBeVisible();
      await expect(page.getByText(/Si algo no puede esperar, APX te avisa enseguida/)).toBeVisible();
      await expect(page.getByText("Buscar en la web", { exact: true })).toHaveCount(0);

      const picker = page.getByRole("button", { name: "Todos mis proyectos" });
      await picker.click();
      await page.getByRole("menuitem", { name: "Acme web" }).click();
      await page.getByRole("menuitem", { name: "Contoso docs" }).click();
      await page.screenshot({ path: info.outputPath(`projects-menu-${width}.png`) });
      await page.keyboard.press("Escape");
      const chips = page.locator(".discovery__chips");
      await expect(chips).toContainText("Acme web");
      await expect(chips).toContainText("Contoso docs");
      await expect(chips).not.toContainText("Northwind app");
      await expect(page.getByRole("button", { name: "2 proyectos" })).toBeVisible();

      const places = page.getByRole("textbox", { name: "Lugares", exact: true });
      for (const place of ["Bariloche", "Buenos Aires"]) {
        await places.fill(place);
        await places.blur();
        await expect(page.getByRole("button", { name: `Quitar ${place}`, exact: true })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`projects-places-${width}.png`) });
      await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Cambios guardados" })).toBeVisible();
      const saved = (await env.client.call("discovery.settings", {})).settings;
      expect(saved.projects).toBe("selected");
      expect(saved.project_ids).toHaveLength(2);
      expect(saved.places).toEqual(["Bariloche", "Buenos Aires"]);

      await page.getByRole("radio", { name: "En una rutina" }).click();
      await expect(page.getByText("Tu superagente todavía no tiene una rutina para esto.")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`routine-none-${width}.png`) });
      await page.getByRole("button", { name: "Crear una rutina", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Nueva rutina" })).toBeVisible();
    } finally {
      await page.goto("about:blank");
      await env.core.close();
      await env.cleanup();
    }
  });
}
