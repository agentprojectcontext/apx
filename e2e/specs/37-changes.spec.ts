import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { callTool, say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { expect, test } from "./kit.ts";

test("cambios: lista unificada, diff expandible en vivo, historial y registros antiguos", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let advance = () => {};
  const pause = new Promise<void>((resolve) => {
    advance = resolve;
  });
  let step = 0;
  const llm = scriptedLlm(async (_req, { said, afterTool }) => {
    step = afterTool ? step + 1 : 0;
    if (said === "single")
      return afterTool ? say("Done") : callTool("single", "file_write", { path: "Simple.md", content: "One\n" });
    if (step === 0) return callTool("guide", "file_write", { path: "Guide.md", content: "# Guía\n\nOriginal\n" });
    if (step === 1) {
      await pause;
      return callTool("revise", "file_edit", { path: "Guide.md", old: "Original", new: "Final" });
    }
    if (step === 2)
      return callTool("code", "file_edit", {
        path: "src/app.ts",
        old: 'const status = "Old";',
        new: 'const status = "New";',
      });
    if (step === 3)
      return callTool("note", "file_write", { path: "Notes.txt", content: "Next steps\n\n- Review\n- Ship\n" });
    return say("Done");
  });
  const env = await startCore({ port, llm });
  try {
    const work = path.join(env.home, "work");
    fs.mkdirSync(path.join(work, "src"), { recursive: true });
    fs.writeFileSync(path.join(work, "src", "app.ts"), 'const status = "Old";\n');
    await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
    await env.client.call("setup.finish", {});
    const thread = await env.client.call("threads.create", {
      kind: "loose",
      agent_id: "roby",
      title: "Revisar archivos",
    });
    await page.goto(`${env.core.url}/#thread=${thread.id}&panel=changes`);
    const panel = page.locator(".sidepanel");
    const input = page.getByRole("textbox", { name: /^Escribile a/ });
    await input.fill("changes");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(panel.getByText("Cambios: 1 archivo editado", { exact: true })).toBeVisible();
    const guide = panel.locator(".wchanges__file").filter({ has: page.getByRole("button", { name: /Guide\.md/ }) });
    await guide.getByRole("button").click();
    await expect(guide.locator(".diff__line--add")).toContainText(["# Guía", "", "Original"]);
    advance();
    await expect(page.locator(".transcript").getByText("Done", { exact: true })).toHaveCount(1);
    await expect(panel.getByText("Cambios: 3 archivos editados", { exact: true })).toBeVisible();
    await expect(panel.locator(".wchanges__file")).toHaveCount(3);
    await expect(panel.locator(".changes")).toHaveCount(0);
    await expect(guide.locator(".diff__line--add")).toContainText(["# Guía", "", "Final"]);
    await expect(guide).not.toContainText("Original");
    const code = panel.locator(".wchanges__file").filter({ has: page.getByRole("button", { name: /src\/app\.ts/ }) });
    await code.getByRole("button").click();
    await expect(code.locator(".diff__line--del")).toContainText('const status = "Old";');
    await expect(code.locator(".diff__line--add")).toContainText('const status = "New";');
    await expect(code.locator(".diff__line--add .diff__n")).toHaveText("1");
    await expect(panel.locator(".diff")).toHaveCount(2);
    await code.getByRole("button").click();
    await expect(code.locator(".diff")).toHaveCount(0);
    await code.getByRole("button").click();
    await page.screenshot({ path: "/tmp/apx-changes.png", fullPage: true });
    await env.client.call("threads.send", { thread: thread.id, text: "single" });
    await env.settle(thread.id);
    await expect(panel.getByText("Cambios: 1 archivo editado", { exact: true })).toBeVisible();
    await panel.getByRole("combobox", { name: "Elegir cambios" }).selectOption("all");
    await expect(panel.locator(".wchanges__file")).toHaveCount(4);
    fs.unlinkSync(path.join(work, "Guide.md"));
    await page.reload();
    await panel.getByRole("combobox", { name: "Elegir cambios" }).selectOption("all");
    await guide.getByRole("button").click();
    await expect(guide.locator(".diff__line--add")).toContainText(["# Guía", "", "Final"]);
    const legacy = env.core.store.messages.add({
      thread_id: thread.id,
      author: { kind: "agent", id: "roby" },
      parts: [
        { type: "changes", cwd: work, edits: true, files: [{ path: "src/app.ts", status: "M", added: 1, removed: 1 }] },
      ],
    });
    await panel.getByRole("combobox", { name: "Elegir cambios" }).selectOption("latest");
    await expect(panel.locator(".wchanges__file")).toHaveCount(1);
    await code.getByRole("button").click();
    await expect(
      panel.getByText("Contenido actual: este cambio no guardó diff histórico.", { exact: true }),
    ).toBeVisible();
    await expect(code.locator(".diff__line--ctx")).toContainText(['const status = "New";']);
    await expect(code.locator(".diff__line--add, .diff__line--del")).toHaveCount(0);
    const legacyPart = legacy.parts[0];
    if (legacyPart?.type !== "changes" || !legacyPart.files[0]) throw new Error("Missing legacy edit");
    legacy.parts = [{ ...legacyPart, files: [{ ...legacyPart.files[0], diff: "@@ -0,0 +1 @@\n+Snapshot\n" }] }];
    env.core.store.messages.setPart(legacy, 0);
    await expect(code.locator(".diff__line--add")).toContainText("Snapshot");
    fs.writeFileSync(path.join(work, "src", "app.ts"), "Current after timeout\n");
    legacy.parts = [legacyPart];
    env.core.store.messages.setPart(legacy, 0);
    await expect(code.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await expect(code.locator(".wchanges__notice")).toBeVisible();
    await expect(code.locator(".diff__line--ctx")).toContainText(["Current after timeout"]);
  } finally {
    advance();
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});

test("cambios: los archivos de la carpeta temporal se listan aparte, con su diff", async ({ page }) => {
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as AddressInfo).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const llm = scriptedLlm(async (req, { afterTool }) => {
    if (afterTool) return say("Done");
    const temp = /your temp folder, (\S+), never/.exec(String(req.messages[0]?.content ?? ""))?.[1] ?? "";
    return callTool("draft", "file_write", { path: path.join(temp, "draft.py"), content: "print(42)\n" });
  });
  const env = await startCore({ port, llm });
  try {
    await env.client.call("setup.finish", {});
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Borrador" });
    await page.goto(`${env.core.url}/#thread=${thread.id}&panel=changes`);
    await page.getByRole("textbox", { name: /^Escribile a/ }).fill("draft");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".transcript").getByText("Done", { exact: true })).toHaveCount(1);
    await expect(page.locator(".changes__head")).toContainText("Archivos en la carpeta temporal: 1");
    const scratch = page.locator(".sidepanel").getByRole("region", { name: "Carpeta temporal del chat" });
    await scratch.getByRole("button", { name: /draft\.py/ }).click();
    await expect(scratch.locator(".diff__line--add")).toContainText("print(42)");
  } finally {
    // Detach the browser before stopping its server; reconnect timers must not outlive the fixture.
    await page.goto("about:blank");
    await env.core.close();
    await env.cleanup();
  }
});
