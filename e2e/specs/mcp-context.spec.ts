import net, { type AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

async function fixture(page: Page, language: "en" | "es" = "es") {
  await page.addInitScript((language) => {
    if (location.origin !== "null") localStorage.setItem("apx.prefs", JSON.stringify({ language }));
  }, language);
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const env = await startCore({
    port,
    llm: scriptedLlm(() =>
      say(
        "[Acme](apx:resources/mcp/acme/global) · [Missing](apx:resources/mcp/acme/missing-project) · [Choose](apx:resources/mcp/acme)",
      ),
    ),
  });
  await env.client.call("setup.finish", {});
  const project = (await env.client.call("projects.create", { name: "Acme workspace" })).project.id;
  await env.client.call("secrets.set", { name: "PROJECT_ONLY", value: "fixture-account-value", project });
  await env.client.call("mcp.set", { name: "acme", server: { command: "acme-command", env: { TOKEN: "Bearer " } } });
  await page.goto(env.core.url);
  await page.getByRole("textbox", { name: /^(Escribile a|Message)/ }).fill("edit connection");
  await page.getByRole("button", { name: language === "es" ? "Enviar" : "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Acme", exact: true })).toBeVisible();
  return { env, project };
}

test("chat editor chooses effective variables with the keyboard, preserves text and moves private availability", async ({
  page,
}) => {
  const { env, project } = await fixture(page);
  try {
    const location = page.url();
    await page.getByRole("button", { name: "Acme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar acme" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cerrar", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: /Usar una variable/ }).click();
    await expect(page.getByText("No hay variables disponibles", { exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: /Buscar variables/ }).press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Vive en" }).click();
    await page.getByRole("option", { name: "Acme workspace", exact: true }).click();
    const field = dialog.getByRole("textbox", { name: "Valor TOKEN", exact: true });
    await field.fill("Bearer ");
    await field.press("Control+Space");
    const search = page.getByRole("searchbox", { name: /Buscar variables/ });
    await search.fill("PROJECT_ONLY");
    await expect(page.getByRole("option", { name: "PROJECT_ONLY", exact: true })).toBeVisible();
    await search.press("Enter");
    await expect(field).toHaveText("Bearer PROJECT_ONLY×");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(location);
    const server = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "acme");
    expect(server?.only).toBe(true);
    expect(server?.project_id).toBe(project);
    expect(server?.definition?.env).toEqual({ TOKEN: "Bearer secret://PROJECT_ONLY" });
    expect(JSON.stringify(server)).not.toContain("fixture-account-value");
    await expect(page.getByRole("button", { name: "Acme", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Acme", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Vive en" }).click();
    await page.getByRole("option", { name: "Global", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("PROJECT_ONLY");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect((await env.client.call("mcp.list", {})).servers.find((s) => s.name === "acme")?.only).toBe(true);
    await page.getByRole("button", { name: "Missing", exact: true }).click();
    await expect(page.getByText("Esta conexión ya no está disponible.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Comando", exact: true })).toHaveCount(0);
    expect(page.url()).toBe(location);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("an ambiguous name asks which connection and never offers private variables to a repository definition", async ({
  page,
}) => {
  const { env, project } = await fixture(page);
  try {
    await env.client.call("mcp.set", { name: "acme", project, server: { command: "acme-project-command" } });
    await page.getByRole("button", { name: "Choose", exact: true }).click();
    await expect(page.getByText("Elegí la conexión que querés abrir.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "acme · Acme workspace", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar acme" });
    await expect(dialog.getByRole("textbox", { name: "Comando", exact: true })).toHaveValue("acme-project-command");
    await expect(dialog.getByRole("combobox", { name: "Vive en" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /Usar una variable/ })).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`connection editor is usable at ${width}px in ${language}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const { env, project } = await fixture(page, language);
      const es = language === "es";
      try {
        await env.client.call("secrets.set", { name: "ACME_TOKEN", value: "fixture-global-value" });
        await env.client.call("mcp.set", {
          name: "acme",
          server: {
            url: "https://example.com/mcp",
            env: { MODE: "read" },
            headers: { Authorization: "Bearer secret://ACME_TOKEN" },
          },
        });
        await page.getByRole("button", { name: "Acme", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: es ? "Editar acme" : "Edit acme" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("textbox", { name: /^(Valor|Value) Authorization$/ })).toHaveText(
          "Bearer ACME_TOKEN×",
        );
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath("editor-filled.png"), fullPage: true });
        await dialog.getByRole("button", { name: /^(Usar una variable|Use a variable)/ }).click();
        await expect(page.getByRole("option", { name: "ACME_TOKEN", exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath("picker-filled.png"), fullPage: true });
        await page.getByRole("searchbox", { name: /^(Buscar variables|Search variables)/ }).press("Escape");
        await dialog.getByRole("combobox", { name: es ? "Vive en" : "Lives in" }).click();
        await page.getByRole("option", { name: "Acme workspace", exact: true }).click();
        await dialog.getByRole("button", { name: es ? "Guardar" : "Save", exact: true }).click();
        await expect(dialog).toBeHidden();
        const server = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "acme");
        expect(server?.project_id).toBe(project);
        expect(server?.definition?.env).toEqual({ MODE: "read" });
        expect(server?.definition?.headers).toEqual({ Authorization: "Bearer secret://ACME_TOKEN" });
        await page.getByRole("button", { name: "Missing", exact: true }).click();
        await expect(
          page.getByText(es ? "Esta conexión ya no está disponible." : "This connection is no longer available.", {
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({ path: info.outputPath("missing-connection.png"), fullPage: true });
      } finally {
        await page.goto("about:blank");
        await env.core.close();
        await env.cleanup();
      }
    });
  }
}

test("a late variable response from another scope cannot replace the current choices", async ({ page }) => {
  const { env } = await fixture(page);
  const release = Promise.withResolvers<void>();
  const seen = Promise.withResolvers<void>();
  try {
    await page.getByRole("button", { name: "Acme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar acme" });
    await page.route(
      "**/rpc/secrets.list",
      async (route) => {
        seen.resolve();
        await release.promise;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            result: { secrets: [{ name: "OLD_GLOBAL", updated_at: "2026-01-01", used_in: [], sites: [] }] },
          }),
        });
      },
      { times: 1 },
    );
    await dialog.getByRole("button", { name: /Usar una variable/ }).click();
    await seen.promise;
    await page.getByRole("searchbox", { name: /Buscar variables/ }).press("Escape");
    await dialog.getByRole("combobox", { name: "Vive en" }).click();
    await page.getByRole("option", { name: "Acme workspace", exact: true }).click();
    await dialog.getByRole("button", { name: /Usar una variable/ }).click();
    await expect(page.getByRole("option", { name: "PROJECT_ONLY", exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) => response.url().endsWith("/rpc/secrets.list") && !response.request().postDataJSON().project,
    );
    release.resolve();
    await oldResponse;
    await expect(page.getByRole("option", { name: "PROJECT_ONLY", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "OLD_GLOBAL", exact: true })).toHaveCount(0);
  } finally {
    release.resolve();
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("a denied connection is explained without exposing an editor and can be retried", async ({ page }) => {
  const { env } = await fixture(page);
  try {
    await page.route(
      "**/rpc/mcp.list",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "unauthorized", message: "not allowed" } }),
        });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "Acme", exact: true }).click();
    await expect(page.getByText("No tenés acceso a esta conexión.", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Comando", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Editar acme" })).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("variable picker retries failed loads and distinguishes no matches from an empty list", async ({ page }, info) => {
  const { env } = await fixture(page);
  try {
    await page.getByRole("button", { name: "Acme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Editar acme" });
    await dialog.getByRole("button", { name: /Usar una variable/ }).click();
    await expect(page.getByText("No hay variables disponibles", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("picker-empty.png"), fullPage: true });
    await page.getByRole("searchbox", { name: /Buscar variables/ }).press("Escape");
    await env.client.call("secrets.set", { name: "ACME_TOKEN", value: "fixture-global-value" });
    await page.route(
      "**/rpc/secrets.list",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "unavailable", message: "temporarily unavailable" } }),
        });
      },
      { times: 1 },
    );
    await dialog.getByRole("button", { name: /Usar una variable/ }).click();
    await expect(page.getByText("No se pudieron cargar las variables.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("picker-error.png"), fullPage: true });
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByRole("option", { name: "ACME_TOKEN", exact: true })).toBeVisible();
    await page.getByRole("searchbox", { name: /Buscar variables/ }).fill("unknown-variable");
    await expect(page.getByText("Nada coincide con la búsqueda.", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
