import type { Page } from "@playwright/test";
import type { Memory, MemorySettings } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

const job = (state: string) => ({
  id: "capture:run_memory",
  kind: "capture",
  agent_id: "superagent",
  thread_id: "th_memory",
  state,
  attempts: 1,
  updated_at: "2026-01-01T00:00:00Z",
  result: null,
  error: null,
});

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function memoryDialog(page: Page) {
  await open(page);
  return selectMemoryDialog(page);
}

async function selectMemoryDialog(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("memoria");
  await page.getByRole("option", { name: /Memoria/ }).click();
  return page.getByRole("dialog", { name: "Configuración" });
}

async function enabledMemory() {
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
    aux_model: before.aux_model,
  });
  return async () => {
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
  };
}

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

test("a late maintenance failure after closing stays dismissed and a reopened panel can run again", async ({
  page,
}) => {
  const restore = await enabledMemory();
  const waiting = gate();
  let attempts = 0;
  await page.route("**/rpc/memory.status", (route) => route.fulfill({ json: { ok: true, result: { jobs: [] } } }));
  await page.route("**/rpc/memory.maintenance", async (route) => {
    if (++attempts === 1) {
      await waiting.promise;
      await route.fulfill({ json: { ok: false, error: { code: "unavailable", message: "Late maintenance failure" } } });
    } else {
      await route.fulfill({ json: { ok: true, result: { queued: 1, jobs: [job("completed")] } } });
    }
  });
  try {
    const dialog = await memoryDialog(page);
    const dream = dialog.getByRole("button", { name: "Revisar duplicados ahora" });
    await dream.click();
    await expect(dream).toBeDisabled();
    await expect.poll(() => attempts).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const response = page.waitForResponse((r) => r.url().endsWith("/rpc/memory.maintenance"));
    waiting.release();
    await (await response).finished();
    const reopened = await selectMemoryDialog(page);
    await expect(page.getByText("Memoria: Late maintenance failure", { exact: true })).toHaveCount(0);
    const retry = reopened.getByRole("button", { name: "Revisar duplicados ahora" });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(reopened.getByText("Completado", { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  } finally {
    waiting.release();
    await restore();
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

test("memory maintenance reports failure, releases busy controls and retries the intended action", async ({ page }) => {
  const restore = await enabledMemory();
  const response = gate();
  const calls: unknown[] = [];
  await page.route("**/rpc/memory.status", (route) =>
    route.fulfill({
      json: { ok: false, error: { code: "unavailable", message: "Initial status temporarily unavailable" } },
    }),
  );
  await page.route("**/rpc/memory.maintenance", async (route) => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 1) {
      await response.promise;
      await route.fulfill({
        json: { ok: false, error: { code: "unavailable", message: "Maintenance temporarily unavailable" } },
      });
    } else {
      await route.fulfill({
        json: { ok: true, result: { queued: 1, jobs: [{ ...job("failed"), error: "Review needs retry" }] } },
      });
    }
  });
  try {
    const dialog = await memoryDialog(page);
    const backfill = dialog.getByRole("button", { name: "Revisar chats anteriores" });
    const dream = dialog.getByRole("button", { name: "Revisar duplicados ahora" });
    await backfill.click();
    await expect(backfill).toBeDisabled();
    await expect(dream).toBeDisabled();
    expect(calls).toHaveLength(1);
    response.release();
    await expect(page.getByText("Memoria: Maintenance temporarily unavailable", { exact: true })).toBeVisible();
    await expect(backfill).toBeEnabled();
    await expect(dream).toBeEnabled();
    await backfill.click();
    await expect(dialog.getByText("Falló · Review needs retry", { exact: true })).toBeVisible();
    await dream.click();
    await expect.poll(() => calls.length).toBe(3);
    expect(calls).toEqual([
      { backfill: true, dream: false },
      { backfill: true, dream: false },
      { backfill: false, dream: true },
    ]);
  } finally {
    response.release();
    await restore();
  }
});

test("memory jobs poll without overlapping, recover a status failure and stop after completion or closing", async ({
  page,
}) => {
  const restore = await enabledMemory();
  const waiting = gate();
  let reads = 0;
  await page.clock.install();
  await page.route("**/rpc/memory.status", async (route) => {
    const n = ++reads;
    if (n === 2) await waiting.promise;
    if (n === 3) {
      await route.fulfill({
        json: { ok: false, error: { code: "unavailable", message: "Status temporarily unavailable" } },
      });
    } else {
      const state = n === 1 || n > 4 ? "pending" : n === 2 ? "working" : "completed";
      await route.fulfill({ json: { ok: true, result: { jobs: [job(state)] } } });
    }
  });
  await page.route("**/rpc/memory.maintenance", (route) =>
    route.fulfill({ json: { ok: true, result: { queued: 1, jobs: [job("pending")] } } }),
  );
  try {
    const dialog = await memoryDialog(page);
    const row = dialog.locator(".res__row").filter({ hasText: "Guardar recuerdos duraderos" });
    await expect(row.getByText("En espera", { exact: true })).toBeVisible();
    await page.clock.fastForward(5000);
    await expect.poll(() => reads).toBe(2);
    await page.clock.fastForward(10000);
    expect(reads).toBe(2);
    waiting.release();
    await expect(row.getByText("Trabajando", { exact: true })).toBeVisible();
    const failedResponse = page.waitForResponse((r) => r.url().endsWith("/rpc/memory.status"));
    await page.clock.fastForward(5000);
    await failedResponse;
    await expect(row.getByText("Trabajando", { exact: true })).toBeVisible();
    await page.clock.fastForward(5000);
    await expect(row.getByText("Completado", { exact: true })).toBeVisible();
    await page.clock.fastForward(15000);
    expect(reads).toBe(4);
    await dialog.getByRole("button", { name: "Revisar duplicados ahora" }).click();
    await expect(row.getByText("En espera", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.clock.fastForward(15000);
    expect(reads).toBe(4);
  } finally {
    waiting.release();
    await restore();
  }
});

test("an older initial memory status cannot overwrite the result of a manual maintenance action", async ({ page }) => {
  const restore = await enabledMemory();
  const waiting = gate();
  let reads = 0;
  await page.route("**/rpc/memory.status", async (route) => {
    reads++;
    await waiting.promise;
    await route.fulfill({ json: { ok: true, result: { jobs: [job("pending")] } } });
  });
  await page.route("**/rpc/memory.maintenance", (route) =>
    route.fulfill({ json: { ok: true, result: { queued: 1, jobs: [job("completed")] } } }),
  );
  try {
    const dialog = await memoryDialog(page);
    await expect.poll(() => reads).toBe(1);
    await dialog.getByRole("button", { name: "Revisar duplicados ahora" }).click();
    const row = dialog.locator(".res__row").filter({ hasText: "Guardar recuerdos duraderos" });
    await expect(row.getByText("Completado", { exact: true })).toBeVisible();
    const initial = page.waitForResponse((r) => r.url().endsWith("/rpc/memory.status"));
    waiting.release();
    await initial;
    await expect(row.getByText("Completado", { exact: true })).toBeVisible();
    await expect(row.getByText("En espera", { exact: true })).toHaveCount(0);
  } finally {
    waiting.release();
    await restore();
  }
});
