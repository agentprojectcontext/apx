// A routine's runs say how each ended in plain words: nothing worth telling is one badge everywhere, and a failure says
// why (no connection to the model provider), never the raw error.
import { expect, open, rpc, test, until } from "./kit.ts";

type Run = { run_id: string; thread_id: string; state: string; failure?: string; delivered?: boolean };
type Routine = { id: string; name: string };

const runsOf = async (id: string) => (await rpc<{ runs: Run[] }>("routines.runs", { routine: id })).runs;
async function runOnce(id: string, n: number) {
  await rpc("routines.run", { routine: id });
  await until(async () => {
    const runs = await runsOf(id);
    return runs.length === n && runs.every((r) => r.delivered !== undefined);
  });
  return (await runsOf(id))[0] as Run;
}

let routine: Routine;
let watchRun: Run;

test.beforeAll(async () => {
  await rpc("setup.finish");
  const agent = "superagent";
  routine = await rpc<Routine>("routines.set", {
    name: "Vigilar correo",
    agent,
    schedule: { kind: "manual" },
    prompt: "lose the connection while checking the mail",
  });
  const failed = await runOnce(routine.id, 1);
  expect(failed.state).toBe("failed");
  expect(failed.failure).toBe("network");
  await rpc("routines.set", {
    id: routine.id,
    name: "Vigilar correo",
    agent,
    schedule: { kind: "manual" },
    prompt: "nothing worth telling unless a client writes",
  });
  const quiet = await runOnce(routine.id, 2);
  expect(quiet.state).toBe("completed");
  expect(quiet.delivered).toBe(false);

  // A watch run twice: the second has nothing new, so the model is not called.
  const watch = await rpc<Routine>("routines.set", {
    name: "Vigilar pendientes",
    agent,
    action: "watch",
    schedule: { kind: "manual" },
    prompt: "Tell me only what matters now.",
  });
  await runOnce(watch.id, 1);
  watchRun = await runOnce(watch.id, 2);
});

for (const width of [1280, 390]) {
  test(`a routine's runs say "nothing new" with a badge and why one failed (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await open(page, `#routine=${routine.id}`);
    const runs = page.locator(".rtchat__run");
    await expect(runs).toHaveCount(2);
    // The failed run says why in the person's words, never the provider's error.
    const failed = runs.first().locator(".rtchat__divider");
    await expect(failed).toContainText("Falló · Sin conexión");
    await expect(failed.locator(".rtchat__mark")).toHaveAttribute("title", /sin conexión/);
    // The technical reason stays folded under "Detalles", never on screen.
    await expect(page.getByText(/ENOTFOUND|fetch failed|Could not finish/)).toBeHidden();
    // The run that had nothing to tell: the badge on its line, and no bare SKIP anywhere.
    const quiet = runs.nth(1).locator(".rtchat__divider");
    await expect(quiet.getByText("Sin novedades")).toBeVisible();
    await expect(quiet.getByText("La acción corrió")).toHaveCount(0);
    // Each run's line fits the screen, badges included.
    for (const line of await page.locator(".rtchat__divider").all()) {
      const box = await line.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      const marks = await line.locator(".rtchat__mark").all();
      for (const m of marks) {
        const b = await m.boundingBox();
        expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0));
      }
    }
    await expect(page.getByText(/^SKIP$/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`routine-runs-${width}.png`) });
    // Opened as a chat of its own, the quiet watch run says it with the same badge, in Spanish.
    await open(page, `#thread=${watchRun.thread_id}`);
    await expect(page.locator(".quietmark").getByText("Sin novedades")).toBeVisible();
    await expect(page.locator(".quietmark")).toContainText("No se llamó al modelo");
    await expect(page.getByText(/Nothing new to watch/)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`routine-quiet-thread-${width}.png`) });
  });
}
