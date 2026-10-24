import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("documentos: txt como Markdown, apertura explícita, fuente, descarga y recarga", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm((_req, { said, afterTool }) => {
    if (afterTool) return say("Done");
    if (said === "small edit") return callTool("write", "file_write", { path: "Small.md", content: "Short note\n" });
    if (said === "change document")
      return callTool("edit", "file_edit", { path: "Report.txt", old: "Ready", new: "Changed" });
    return callTool("open", "open_document", { path: said, ...(said === "Literal.txt" ? { format: "text" } : {}) });
  });
  const env = await startCore({ port, llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(work, { recursive: true });
    const source =
      "# Project report\n\n**Decision**\n\n| Stage | Status |\n| --- | --- |\n| Design | Ready |\n\n- First step\n- Second step\n";
    fs.writeFileSync(path.join(work, "Report.txt"), source);
    fs.writeFileSync(path.join(work, "Literal.txt"), "# Literal heading\n");
    await env.client.call("setup.finish", {});
    const health = await env.client.call("system.health", {});
    expect(health.code_sha).toBeTruthy();
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    const send = async (text: string, count: number) => {
      await input.fill(text);
      await page.getByRole("button", { name: "Enviar", exact: true }).click();
      await expect(page.locator(".transcript").getByText("Done", { exact: true })).toHaveCount(count);
    };
    await send("small edit", 1);
    await expect(page.locator(".sidepanel")).toHaveCount(0);
    await send("Report.txt", 2);
    const panel = page.locator(".sidepanel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Documentos", { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Project report", exact: true })).toBeVisible();
    await expect(panel.getByRole("cell", { name: "Ready", exact: true })).toBeVisible();
    await expect(page.locator(".documentpart").getByText("Documento", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Ver código fuente", exact: true }).click();
    await expect(panel.locator(".documentpanel__source")).toHaveText(source.trim());
    await panel.getByRole("button", { name: "Leer documento", exact: true }).click();
    await panel.getByRole("button", { name: "Cerrar panel", exact: true }).click();
    await send("change document", 3);
    await expect(panel).toHaveCount(0);
    await page.locator(".documentpart").click();
    await expect(panel.getByRole("cell", { name: "Ready", exact: true })).toBeVisible();
    fs.unlinkSync(path.join(work, "Report.txt"));
    await page.reload();
    await expect(panel.getByRole("cell", { name: "Ready", exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Descargar", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("Report.txt");
    const saved = await download.path();
    if (!saved) throw new Error("Missing document download");
    expect(fs.readFileSync(saved, "utf8")).toBe(source);
    await send("Literal.txt", 4);
    await expect(panel.locator(".documentpanel__source")).toHaveText("# Literal heading");
    await panel.getByRole("button", { name: "Leer documento", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Literal heading", exact: true })).toBeVisible();
    // Back to the chat's documents, newest first, and into another one.
    await panel.getByRole("button", { name: "Todos los documentos (2)" }).click();
    const list = panel.getByRole("list", { name: "Documentos de este chat" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await list.getByRole("button", { name: /Report\.txt/ }).click();
    await page.reload();
    await expect(panel.getByRole("cell", { name: "Ready", exact: true })).toBeVisible();
    await page.screenshot({ path: "/tmp/apx-documents.png", fullPage: true });
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
