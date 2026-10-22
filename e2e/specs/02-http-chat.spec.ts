import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

// A non-localhost hostname keeps HTTP genuinely insecure without exposing the test core to the network.
test.use({
  launchOptions: {
    executablePath: process.env.E2E_CHROMIUM || undefined,
    args: ["--host-resolver-rules=MAP panel.test 127.0.0.1", "--no-proxy-server"],
  },
});

for (const host of ["127.0.0.1", "panel.test"]) {
  test(`chat sends and restores failed drafts on HTTP ${host}`, async ({ page }) => {
    await page.goto(`http://${host}:${process.env.E2E_PORT ?? 7460}/`);
    await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
    expect(await page.evaluate(() => isSecureContext)).toBe(host === "127.0.0.1");
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe(host === "127.0.0.1" ? "function" : "undefined");
    const before = (await rpc<{ threads: Thread[] }>("threads.list")).threads.length;
    const sends: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/rpc/threads.send")) sends.push(r.postData() ?? "");
    });
    await page.getByRole("combobox", { name: "Nuevo chat" }).first().click();
    // These specs run last (their own browser options), when the list holds many agents: search, as an owner would.
    await page.getByPlaceholder("Buscá un agente").fill("Scout");
    await page.getByRole("option", { name: /Scout/ }).first().click();
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill(`HTTP first ${host}`);
    await box.press("Enter");
    await expect(page.locator(".transcript").getByText(`Got it: HTTP first ${host}`)).toBeVisible();
    await expect(box).toHaveValue("");
    expect(sends).toHaveLength(1);
    expect((await rpc<{ threads: Thread[] }>("threads.list")).threads).toHaveLength(before + 1);
    const thread = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("thread");
    const saved = await rpc<{ messages: Message[] }>("threads.get", { thread });
    expect(saved.messages.filter((m) => m.author.kind === "user")).toHaveLength(1);
    expect(saved.messages.some((m) => m.author.kind === "agent")).toBe(true);

    // Failure before the RPC must be visible and give back both the words and already-uploaded files.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "draft.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Keep this attachment"),
      });
    await expect(page.locator(".attchip__spin")).toHaveCount(0);
    await expect(page.locator(".attchips").getByText("draft.txt")).toBeVisible();
    await page.evaluate(() => {
      for (const key of ["randomUUID", "getRandomValues"]) {
        Object.defineProperty(crypto, key, {
          configurable: true,
          value: () => {
            throw new Error("Random source refused");
          },
        });
      }
    });
    await box.fill("Keep my draft");
    await box.press("Enter");
    await expect(box).toHaveValue("Keep my draft");
    await expect(page.getByText(/Random source refused/)).toBeVisible();
    await expect(page.locator(".attchips").getByText("draft.txt")).toBeVisible();
    expect(sends).toHaveLength(1);
    await page.evaluate(() => {
      Reflect.deleteProperty(crypto, "randomUUID");
      Reflect.deleteProperty(crypto, "getRandomValues");
    });
    await box.press("Enter");
    await expect(
      page.locator(".transcript").getByText(/^Got it: File in your temp folder:.*draft\.txt/s),
    ).toBeVisible();
    await expect(box).toHaveValue("");
    await expect(page.locator(".attchips")).toHaveCount(0);
    expect(sends).toHaveLength(2);
    expect(JSON.parse(sends[1] ?? "{}").attachments).toHaveLength(1);
    const retried = await rpc<{ messages: Message[] }>("threads.get", { thread });
    const owner = retried.messages.filter((m) => m.author.kind === "user");
    expect(owner).toHaveLength(2);
    expect(owner[1]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Keep my draft" }),
        expect.objectContaining({ type: "file" }),
      ]),
    );
    await page.reload();
    await expect(
      page.locator(".transcript").getByText(/^Got it: File in your temp folder:.*draft\.txt/s),
    ).toBeVisible();
    const surface = await rpc<{ id: string }>("surfaces.show", {
      name: `http-preview-${host.replaceAll(".", "-")}`,
      title: "HTTP preview",
      html: "<h1>Secure nonce preview</h1>",
    });
    await page.goto(`http://${host}:${process.env.E2E_PORT ?? 7460}/#app=${surface.id}`);
    await expect(
      page.frameLocator(".surfaceframe__iframe").getByRole("heading", { name: "Secure nonce preview" }),
    ).toBeVisible();
  });
}
