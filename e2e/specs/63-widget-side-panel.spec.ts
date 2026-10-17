// A chat's widget moves to the side panel and leaves a one-line card in the chat, never the widget twice.
import type { Message } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("a widget shows in the side panel, the chat keeps a card of it, and it comes back", async ({ page }) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "roby" });
  await rpc("threads.send", { thread: chat.id, text: "show a widget" });
  await expect
    .poll(async () => {
      const { messages } = await rpc<{ messages: Message[] }>("threads.get", { thread: chat.id });
      return messages.some((m) => m.parts.some((p) => p.type === "surface"));
    })
    .toBe(true);

  await open(page, `#thread=${chat.id}`);
  const transcript = page.locator(".transcript");
  const inline = transcript.locator(".surfacecard").frameLocator("iframe");
  await expect(inline.getByText("Coverage rows")).toBeVisible();

  await transcript.getByRole("button", { name: "Mostrar en el panel lateral" }).click();
  const panel = page.locator(".widgets");
  await expect(panel.frameLocator("iframe").getByText("Coverage rows")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Todos los widgets (1)" })).toBeVisible();
  const card = transcript.locator(".surfacecard--aside");
  await expect(card).toContainText("Coverage audit");
  await expect(card).toContainText("Se muestra en el panel lateral");
  await expect(transcript.locator("iframe")).toHaveCount(0);

  // The side panel has its own close; the widget opens in the browser, privately at this panel's address.
  const head = panel.locator(".widgets__head");
  await expect(head.getByRole("button", { name: "Volver al chat" })).toHaveCount(0);
  let opens = page.waitForEvent("popup");
  await head.getByRole("button", { name: "Abrir en el navegador · solo donde se llega a APX" }).click();
  const surfaceId = new URL((await opens).url()).hash.replace("#app=", "");
  expect(surfaceId).not.toBe("");
  const shared = await rpc<{ share_path?: string }>("surfaces.share", { surface: surfaceId, shared: true });
  opens = page.waitForEvent("popup");
  await head.getByRole("button", { name: "Abrir en el navegador", exact: true }).click();
  expect((await opens).url()).toContain(String(shared.share_path));

  await card.getByRole("button", { name: "Mostrar acá" }).click();
  await expect(panel).toHaveCount(0);
  await expect(inline.getByText("Coverage rows")).toBeVisible();
});
