// Talking to the super-agent from the panel: the message goes out, the (fake) model answers, the chat keeps both.
import { expect, open, rpc, test, world } from "./kit.ts";

test("the owner writes to the super-agent and the answer streams in", async ({ page }) => {
  await open(page);
  const before = await world.llmCalls();
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("What is on today?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Got it: What is on today?")).toBeVisible();
  expect(await world.llmCalls()).toBeGreaterThan(before);
  await expect(box).toHaveValue("");

  // A reload brings the same chat back.
  await page.reload();
  await expect(page.getByText("Got it: What is on today?")).toBeVisible();
});

test("a new chat starts empty and keeps its own conversation", async ({ page }) => {
  await open(page);
  const count = (await rpc<{ threads: unknown[] }>("threads.list")).threads.length;
  await page.getByRole("button", { name: "Nuevo chat" }).first().click();
  await page.getByRole("menuitem", { name: /Scout/ }).click();
  await expect(page.getByRole("textbox", { name: "Escribile a Scout…" })).toBeVisible();
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("Second chat");
  await box.press("Enter");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Second chat" })).toBeVisible();
  expect((await rpc<{ threads: unknown[] }>("threads.list")).threads.length).toBeGreaterThan(count);
});

test("a message is matched to skills by meaning: a recommended chip over the answer, its card, a link to it", async ({
  page,
}) => {
  const { llm } = await world.info();
  await rpc("services.set", {
    id: "e2e-embed",
    service: {
      kind: "embedding",
      dialect: "ollama-embed",
      label: "Ollama",
      base_url: llm,
      enabled: true,
      needs_key: false,
      model: "embeddinggemma",
    },
  });
  await rpc("skills.save", {
    name: "image-gen",
    target: "global",
    content: "---\nname: image-gen\ndescription: Generate an image from a prompt.\n---\nCall the images service.\n",
  });
  try {
    await open(page);
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    await box.fill("creame una imagen de un gato");
    await box.press("Enter");
    await expect(page.getByText("Got it: creame una imagen de un gato")).toBeVisible();
    const chip = page.getByRole("button", { name: "image-gen", exact: true });
    await expect(chip).toBeVisible();
    await chip.click();
    // A match by meaning is only recommended: its name and description enter, the agent decides (DECISIONS.md#d-051).
    await expect(page.getByText(/^Recomendada: muy parecida al mensaje/)).toBeVisible();
    await expect(page.getByText("Generate an image from a prompt.").last()).toBeVisible();
    await page.getByRole("button", { name: "Abrir skill" }).click();
    await expect(page.getByText("Call the images service.")).toBeVisible();
  } finally {
    await rpc("services.set", { id: "e2e-embed", service: null });
  }
});

test("the / menu: commands and skills, a skill named loads whole, /new opens a fresh chat", async ({ page }) => {
  // image-gen stays from the test above; with no embedding engine now, only "/" can bring it in.
  await open(page);
  const box = page.getByRole("textbox", { name: /^Escribile a/ });
  await box.fill("/");
  const menu = page.getByRole("listbox", { name: "Comandos y skills" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("option", { name: /\/compact/ })).toBeVisible();
  await expect(menu.getByRole("option", { name: /\/image-gen/ })).toBeVisible();

  await box.fill("/ima");
  await expect(menu.getByRole("option")).toHaveCount(1);
  await box.press("Enter");
  await expect(box).toHaveValue("/image-gen ");
  await expect(menu).toBeHidden();
  await box.pressSequentially("dibujá un perro");
  await box.press("Enter");
  await expect(page.getByText("Got it: /image-gen dibujá un perro")).toBeVisible();
  await expect(page.getByRole("button", { name: "image-gen", exact: true }).last()).toBeVisible();

  // Esc closes the menu; the text stays as typed.
  await box.fill("/comp");
  await expect(menu).toBeVisible();
  await box.press("Escape");
  await expect(menu).toBeHidden();
  await expect(box).toHaveValue("/comp");

  const count = (await rpc<{ threads: unknown[] }>("threads.list")).threads.length;
  await box.fill("/new");
  await box.press("Enter");
  await expect(page.getByRole("textbox", { name: /^Escribile a/ })).toHaveValue("");
  await expect(page.getByText("Got it: /image-gen dibujá un perro")).toBeHidden();
  expect((await rpc<{ threads: unknown[] }>("threads.list")).threads.length).toBe(count + 1);
});
