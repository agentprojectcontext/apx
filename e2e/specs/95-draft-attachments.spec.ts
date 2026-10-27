import type { Message, Thread } from "../../packages/protocol/src/index.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("deleting a chat during upload clears its draft and ignores the late result", async ({ page }) => {
  await rpc("setup.finish");
  const a = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Deleted upload" });
  const b = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Remaining draft" });
  await open(page, `#thread=${a.id}`);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Deleted words");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/media.upload", async (route) => {
    await held;
    await route.fulfill({
      json: { ok: true, result: { id: "deleted-audio", kind: "audio", name: "note.wav", mime: "audio/wav", bytes: 4 } },
    });
  });
  let transcripts = 0;
  await page.route("**/rpc/media.transcribe", async (route) => {
    transcripts++;
    await route.fulfill({ json: { ok: true, result: { text: "Late words" } } });
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "note.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF") });
  await expect(page.locator(".attchip.is-loading")).toHaveCount(1);
  await rpc("threads.delete", { thread: a.id });
  await page.evaluate((id) => {
    location.hash = `thread=${id}`;
  }, b.id);
  await expect(box).toHaveValue("");
  await box.fill("Keep remaining words");
  const completed = page.waitForResponse("**/rpc/media.upload");
  release();
  await completed;
  await expect(page.locator(".attchip")).toHaveCount(0);
  await expect(box).toHaveValue("Keep remaining words");
  await expect
    .poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem("apx.drafts") ?? "{}")[id], a.id))
    .toBeUndefined();
  expect(transcripts).toBe(0);
});

test("a delayed attachment chunk keeps selected filenames visible", async ({ page }) => {
  await rpc("setup.finish");
  const chat = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Slow preview" });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/AttachChips-*.js", async (route) => {
    await held;
    await route.continue();
  });
  await open(page, `#thread=${chat.id}`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "slow.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "slow.png" })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "Previsualizar slow.png", exact: true })).toBeVisible();
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

for (const width of [412, 1280]) {
  test(`draft image preview and pending uploads survive navigation at ${width}px`, async ({ page }) => {
    await rpc("setup.finish");
    const a = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Draft images" });
    const b = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Other draft" });
    await page.setViewportSize({ width, height: 900 });
    await open(page, `#thread=${a.id}`);
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("Review before sending");
    let uploads = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/rpc/media.upload", async (route) => {
      uploads++;
      await held;
      await route.continue();
    });
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "review.png", mimeType: "image/png", buffer: PNG });
    const preview = page.getByRole("button", { name: "Previsualizar review.png", exact: true });
    await preview.focus();
    await preview.press("Enter");
    const dialog = page.getByRole("dialog", { name: "review.png", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: "review.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".attchip")).toHaveCount(1);
    expect((await rpc<{ messages: Message[] }>("threads.get", { thread: a.id })).messages).toHaveLength(0);
    await page.evaluate((id) => {
      location.hash = `#thread=${id}`;
    }, b.id);
    await expect(box).toHaveValue("");
    await expect(page.locator(".attchip")).toHaveCount(0);
    await box.fill("Unrelated draft");
    release();
    await page.evaluate((id) => {
      location.hash = `#thread=${id}`;
    }, a.id);
    await expect(box).toHaveValue("Review before sending");
    await expect(page.locator(".attchip.is-loading")).toHaveCount(0);
    await expect(preview).toBeVisible();
    await preview.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(uploads).toBe(1);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator(".attchip")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await rpc<{ messages: Message[] }>("threads.get", { thread: a.id })).messages.filter(
            (m) => m.author.kind === "user",
          ).length,
      )
      .toBe(1);
    const sent = (await rpc<{ messages: Message[] }>("threads.get", { thread: a.id })).messages.filter(
      (m) => m.author.kind === "user",
    );
    expect(sent[0]?.parts.filter((p) => p.type === "image")).toHaveLength(1);
    await page.evaluate((id) => {
      location.hash = `#thread=${id}`;
    }, b.id);
    await expect(box).toHaveValue("Unrelated draft");
    await page.evaluate((id) => {
      location.hash = `#thread=${id}`;
    }, a.id);
    await expect(box).toHaveValue("");
    await expect(page.locator(".attchip")).toHaveCount(0);
    expect(uploads).toBe(1);
  });
}

test("navigation retains text and documents without resubmitting uploads", async ({ page }) => {
  await rpc("setup.finish");
  const a = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Document draft" });
  const b = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Other document draft" });
  await open(page, `#thread=${a.id}`);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Keep this document");
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/rpc/media.upload")) uploads++;
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "review.txt", mimeType: "text/plain", buffer: Buffer.from("Document draft") });
  await expect(page.locator(".attchip.is-loading")).toHaveCount(0);
  await page.evaluate((id) => {
    location.hash = `thread=${id}`;
  }, b.id);
  await expect(box).toHaveValue("");
  await expect(page.locator(".attchip")).toHaveCount(0);
  await page.evaluate((id) => {
    location.hash = `thread=${id}`;
  }, a.id);
  await expect(box).toHaveValue("Keep this document");
  await expect(page.locator(".attchip")).toHaveCount(1);
  await expect(page.locator(".attchip")).toContainText("review.txt");
  await page.getByRole("button", { name: "Quitar review.txt", exact: true }).click();
  await expect(box).toHaveValue("Keep this document");
  await expect(page.locator(".attchip")).toHaveCount(0);
  expect(uploads).toBe(1);
});

for (const editOrigin of [false, true]) {
  test(`failed send restores draft with concurrent editing ${editOrigin} without another upload`, async ({ page }) => {
    await rpc("setup.finish");
    const a = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Retry draft" });
    const b = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Separate draft" });
    await open(page, `#thread=${a.id}`);
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("Retry with this image");
    let uploads = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/rpc/media.upload")) uploads++;
    });
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator(".attchip.is-loading")).toHaveCount(0);
    let fail = () => {};
    const held = new Promise<void>((resolve) => {
      fail = resolve;
    });
    let requests = 0;
    await page.route("**/rpc/threads.send", async (route) => {
      requests++;
      if (requests > 1) return route.continue();
      await held;
      await route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Draft send refused" } } });
    });
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await page.evaluate((id) => {
      location.hash = `thread=${id}`;
    }, b.id);
    await expect(box).toHaveValue("");
    await box.fill("Leave this one alone");
    if (editOrigin) {
      await page.evaluate((id) => {
        location.hash = `thread=${id}`;
      }, a.id);
      await expect(box).toHaveValue("");
      await box.fill("New unsent words");
      await page.evaluate((id) => {
        location.hash = `thread=${id}`;
      }, b.id);
      await expect(box).toHaveValue("Leave this one alone");
    }
    fail();
    await expect(page.getByText(/Draft send refused/)).toBeVisible();
    await expect(box).toHaveValue("Leave this one alone");
    await expect(page.locator(".attchip")).toHaveCount(0);
    await page.evaluate((id) => {
      location.hash = `thread=${id}`;
    }, a.id);
    await expect(box).toHaveValue(editOrigin ? "Retry with this image\n\nNew unsent words" : "Retry with this image");
    const preview = page.getByRole("button", { name: "Previsualizar retry.png", exact: true });
    await preview.click();
    await expect(page.getByRole("dialog", { name: "retry.png" }).getByRole("img", { name: "retry.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await rpc<{ messages: Message[] }>("threads.get", { thread: a.id })).messages.filter(
            (m) => m.author.kind === "user",
          ).length,
      )
      .toBe(1);
    const sent = (await rpc<{ messages: Message[] }>("threads.get", { thread: a.id })).messages.filter(
      (m) => m.author.kind === "user",
    );
    expect(sent[0]?.parts.filter((p) => p.type === "image")).toHaveLength(1);
    expect(uploads).toBe(1);
    expect(requests).toBe(2);
  });
}

test("removing an uploading image prevents resurrection and reload only preserves text", async ({ page }) => {
  await rpc("setup.finish");
  const chat = await rpc<Thread>("threads.create", { kind: "loose", agent_id: "roby", title: "Discard draft" });
  await open(page, `#thread=${chat.id}`);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Text survives reload");
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rpc/media.upload", async (route) => {
    await held;
    await route.continue();
  });
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "discard.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Quitar discard.png", exact: true }).click();
  const finished = page.waitForResponse("**/rpc/media.upload");
  release();
  await finished;
  await expect(page.locator(".attchip")).toHaveCount(0);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "session.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator(".attchip.is-loading")).toHaveCount(0);
  await page.reload();
  await expect(box).toHaveValue("Text survives reload");
  await expect(page.locator(".attchip")).toHaveCount(0);
});
