// An agent's reply with a table, an HTML page, a Mermaid diagram and a file it made: the table copies as Markdown and
// CSV, the page and the diagram are cards of their own between the bubbles, drawn with a switch to their code, and the
// file is a chip that opens and saves.
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

const REPLY = [
  "The launch plan is ready.",
  "",
  "| Channel | Status |",
  "| --- | ---: |",
  "| Blog, changelog | Ready |",
  '| X | "Draft" |',
  "",
  "```html",
  '<section style="padding:24px;background:#4338ca;color:#fff"><h2>Version 2.0 is here</h2>',
  '<p onclick="document.title=\'ran\'">Shared workspaces.</p><script>document.title = "ran";</script></section>',
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  Scout --> Atlas",
  "  Atlas --> Launch",
  "```",
].join("\n");

test("a rich reply: table copies, HTML and Mermaid previews, a file chip that opens and saves", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say(REPLY) : callTool("attach", "send_file", { path: "drafts.csv" }),
  );
  const env = await startCore({ port, llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(path.join(work, "drafts.csv"), "draft,length\nLaunch post,420 words\n");
    await env.client.call("setup.finish", {});
    await page.goto(env.core.url);
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await input.fill("Prepare the launch");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const reply = page.locator(".turn", { hasText: "The launch plan is ready." });
    await expect(reply).toBeVisible();
    // The words are a bubble; each block is a card of its own beside it, never inside a bubble.
    await expect(reply.locator(".apx-msg__bubble", { hasText: "The launch plan is ready." })).toBeVisible();
    await expect(reply.locator(".turn__card .apx-codeframe")).toHaveCount(2);
    await expect(reply.locator(".apx-msg__bubble .apx-codeframe")).toHaveCount(0);

    // The table: both copies under it, the CSV with its commas and quotes kept.
    const table = reply.locator(".apx-md__tablebox");
    await table.getByRole("button", { name: "Copiar como Markdown" }).click();
    await expect(table.getByRole("button", { name: "Copiado" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '| Channel | Status |\n| --- | ---: |\n| Blog, changelog | Ready |\n| X | "Draft" |',
    );
    await table.getByRole("button", { name: "Copiar como CSV" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('Channel,Status\r\n"Blog, changelog",Ready\r\nX,"""Draft"""');

    // The HTML page: drawn in a frame with no way back into APX, its own script never runs; Código shows the source.
    const html = reply.locator(".apx-codeframe", { hasText: "HTML" });
    const frame = html.locator("iframe");
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    const page2 = html.frameLocator("iframe");
    await expect(page2.getByRole("heading", { name: "Version 2.0 is here" })).toBeVisible();
    await page2.getByText("Shared workspaces.").click();
    expect(await frame.evaluate((f) => (f as HTMLIFrameElement).contentDocument)).toBeNull();
    await expect(page2.locator("title")).toHaveCount(0);
    // The frame takes the page's height (the sizing script ran), so nothing scrolls inside it.
    await expect.poll(() => frame.evaluate((f) => f.getBoundingClientRect().height)).toBeGreaterThan(120);
    await html.getByRole("radio", { name: "Código" }).click();
    await expect(html.locator(".cm-content")).toContainText('<section style="padding:24px');
    await expect(html.locator(".cm-lineNumbers")).toContainText("2");
    await html.getByRole("button", { name: "Copiar" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("<h2>Version 2.0 is here</h2>");
    await html.getByRole("radio", { name: "Vista previa" }).click();
    await expect(page2.getByRole("heading", { name: "Version 2.0 is here" })).toBeVisible();

    // The diagram: drawn as a picture; Expandir shows it larger.
    const mermaid = reply.locator(".apx-codeframe", { hasText: "Mermaid" });
    const diagram = mermaid.getByRole("img", { name: "Diagrama" });
    await expect(diagram).toBeVisible();
    await expect.poll(() => diagram.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await mermaid.getByRole("button", { name: "Expandir" }).click();
    const dialog = page.getByRole("dialog", { name: "Mermaid" });
    await expect(dialog.getByRole("img", { name: "Diagrama" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(dialog).toHaveCount(0);

    // The file: a chip with its name and size; Abrir shows its text, Descargar saves it.
    const chip = page.locator(".filechip", { hasText: "drafts.csv" });
    await expect(chip).toContainText("B");
    await chip.getByRole("button", { name: "Abrir" }).click();
    const viewer = page.getByRole("dialog", { name: "drafts.csv" });
    await expect(viewer.locator(".cm-content")).toContainText("Launch post,420 words");
    await viewer.getByRole("button", { name: "Cerrar" }).click();
    const download = page.waitForEvent("download");
    await chip.getByRole("button", { name: "Descargar" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("drafts.csv");
    const saved = await file.path();
    if (!saved) throw new Error("Missing downloaded file");
    expect(fs.readFileSync(saved, "utf8")).toBe("draft,length\nLaunch post,420 words\n");
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
