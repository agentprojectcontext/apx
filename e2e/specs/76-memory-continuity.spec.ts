import type { Memory, MemorySettings } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("memory automation controls persist and memory off disables automatic controls", async ({ page }) => {
  await rpc("setup.finish", {});
  const before = await rpc<MemorySettings>("memory.settings");
  await rpc("memory.set_settings", {
    mode: "notes",
    skill_picker: before.skill_picker,
    auto_compact: before.auto_compact,
    auto_recall: true,
    auto_capture: true,
    auto_dream: true,
    daily_memory_calls: 20,
  });
  try {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page
      .getByRole("combobox", { name: "Buscar" })
      .or(page.getByRole("textbox", { name: "Buscar" }))
      .fill("memoria");
    await page.getByRole("option", { name: /Memoria/ }).click();
    const dialog = page.getByRole("dialog", { name: "Configuración" });
    const recall = dialog.getByRole("switch", { name: "Recuperar chats propios automáticamente" });
    await expect(recall).toBeChecked();
    await recall.click();
    await dialog.getByRole("switch", { name: "Guardar recuerdos duraderos" }).click();
    await expect.poll(async () => (await rpc<MemorySettings>("memory.settings")).auto_recall).toBe(false);
    await expect.poll(async () => (await rpc<MemorySettings>("memory.settings")).auto_capture).toBe(false);
    await dialog.getByRole("spinbutton", { name: "Límite diario de llamadas de memoria" }).fill("7");
    await expect.poll(async () => (await rpc<MemorySettings>("memory.settings")).daily_memory_calls).toBe(7);
    await dialog.getByRole("radio", { name: /Sin memoria/ }).click();
    await expect.poll(async () => (await rpc<MemorySettings>("memory.settings")).mode).toBe("off");
    await expect.poll(async () => (await rpc<MemorySettings>("memory.settings")).daily_memory_calls).toBe(7);
    await expect(dialog.getByRole("switch", { name: "Guardar recuerdos duraderos" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Revisar duplicados ahora" })).toBeDisabled();
  } finally {
    const { mode, skill_picker, auto_compact, auto_recall, auto_capture, auto_dream, daily_memory_calls, aux_model } =
      before;
    await rpc("memory.set_settings", {
      mode,
      skill_picker,
      auto_compact,
      auto_recall,
      auto_capture,
      auto_dream,
      daily_memory_calls,
      aux_model,
    });
  }
});

test("memory history shows the old text before restoring a revision", async ({ page }) => {
  const initial = "Acme archived contracts use violet labels.";
  const changed = "Acme archived contracts use amber labels.";
  const note = await rpc<Memory>("memory.add", { scope: "global", text: initial });
  await rpc("memory.add", { id: note.id, scope: "global", text: changed });
  await open(page, "#project=~default&tab=memory");
  const row = page.locator(".memory__row").filter({ hasText: changed });
  await row.getByRole("button", { name: "Fuentes e historial" }).click();
  const previous = row.locator(".memory__history li").filter({ hasText: "Revisión 1" });
  await expect(previous.getByText(initial, { exact: true })).toBeVisible();
  await previous.getByRole("button", { name: "Restaurar esta revisión" }).click();
  await expect
    .poll(
      async () => (await rpc<{ memories: Memory[] }>("memory.list", {})).memories.find((m) => m.id === note.id)?.text,
    )
    .toBe(initial);
  await expect(page.locator(".memory__text").getByText(initial, { exact: true })).toBeVisible();
});
