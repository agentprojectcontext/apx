import type { Message, Result, Thread } from "../../packages/protocol/src/index.ts";
import { expect, rpc, test } from "./kit.ts";

test.use({
  launchOptions: {
    executablePath: process.env.E2E_CHROMIUM || undefined,
    args: ["--host-resolver-rules=MAP panel.test 127.0.0.1", "--no-proxy-server"],
  },
});

test("a failed first send restores files and retries on the created chat without duplication", async ({ page }) => {
  await page.goto(`http://panel.test:${process.env.E2E_PORT ?? 7460}/`);
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  const before = (await rpc<{ threads: Thread[] }>("threads.list")).threads.length;
  let creates = 0;
  let sends = 0;
  let id = "";
  page.on("request", (r) => {
    if (r.url().endsWith("/rpc/threads.send")) sends++;
  });
  await page.route("**/rpc/threads.create", async (route) => {
    creates++;
    const response = await route.fetch({ url: `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}/rpc/threads.create` });
    const body = await response.json();
    id = body.result.id;
    // The thread exists, but preparing the optimistic message fails before threads.send is called.
    await page.evaluate(() => {
      Object.defineProperty(crypto, "getRandomValues", {
        configurable: true,
        value: () => {
          throw new Error("First send refused");
        },
      });
    });
    await route.fulfill({ response });
  });
  await page.getByRole("combobox", { name: "Nuevo chat" }).first().click();
  // These specs run last (their own browser options), when the list holds many agents: search, as an owner would.
  await page.getByPlaceholder("Buscá un agente").fill("Scout");
  await page.getByRole("option", { name: /Scout/ }).first().click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "first.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("First attachment"),
    });
  await expect(page.locator(".attchips").getByText("first.txt")).toBeVisible();
  await expect(page.locator(".attchip__spin")).toHaveCount(0);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("First draft survives");
  await box.press("Enter");
  await expect(page.getByText(/First send refused/)).toBeVisible();
  await expect(box).toHaveValue("First draft survives");
  await expect(page.locator(".attchips").getByText("first.txt")).toBeVisible();
  expect(creates).toBe(1);
  expect(sends).toBe(0);
  await page.evaluate(() => Reflect.deleteProperty(crypto, "getRandomValues"));
  await box.press("Enter");
  await expect(page.locator(".transcript").getByText(/^Got it: File in your temp folder:.*first\.txt/s)).toBeVisible();
  expect(creates).toBe(1);
  expect(sends).toBe(1);
  expect((await rpc<{ threads: Thread[] }>("threads.list")).threads).toHaveLength(before + 1);
  const saved = await rpc<{ messages: Message[] }>("threads.get", { thread: id });
  const owners = saved.messages.filter((m) => m.author.kind === "user");
  expect(owners).toHaveLength(1);
  expect(owners[0]?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "First draft survives" }),
      expect.objectContaining({ type: "file" }),
    ]),
  );
  await expect(box).toHaveValue("");
  await expect(page.locator(".attchips")).toHaveCount(0);
});

test("project helper starts a chat over insecure HTTP with secure idempotency keys", async ({ page }) => {
  const { project } = await rpc<Result<"projects.create">>("projects.create", { name: "HTTP helper" });
  await page.goto(`http://panel.test:${process.env.E2E_PORT ?? 7460}/#project=${project.id}&tab=overview`);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "Revisar contexto del proyecto" }).click();
  const helper = page.getByRole("dialog", { name: "Revisar contexto del proyecto" });
  await helper.getByRole("textbox", { name: "¿Qué debería lograr este proyecto?" }).fill("Review the catalog");
  await helper.getByRole("textbox", { name: "¿Cuál sería un primer resultado útil?" }).fill("A short plan");
  const keys: string[] = [];
  page.on("request", (r) => {
    if (/\/rpc\/threads\.(create|send)$/.test(r.url())) keys.push(r.headers()["idempotency-key"] ?? "");
  });
  await helper.getByRole("button", { name: "Enviar resumen y empezar" }).click();
  await expect(helper).toBeHidden();
  const { threads } = await rpc<Result<"threads.list">>("threads.list", { project_id: project.id });
  expect(threads).toHaveLength(1);
  const details = await rpc<Result<"threads.get">>("threads.get", { thread: threads[0]?.id });
  expect(details.messages.filter((message) => message.author.kind === "user")).toHaveLength(1);
  expect(details.runs).toHaveLength(1);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(2);
  for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
