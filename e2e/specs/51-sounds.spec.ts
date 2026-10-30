// Sounds: the owner picks in Config › Sounds which notices sound on this device; a routine's news sounds with
// "All" and stays quiet with "Requests" (only what waits for the owner's own action).
import { expect, open, rpc, test, until } from "./kit.ts";

test("a routine's news sounds with all notices and stays quiet when only requests sound", async ({ page }) => {
  await rpc("setup.finish", {});
  const prefs = await rpc<Record<string, unknown>>("notices.get");
  await rpc("notices.set", { ...prefs, budget_per_day: 50 });
  // What the page plays, by file: the browser's own player is not asked to make a sound in a headless run.
  await page.addInitScript(() => {
    const played: string[] = [];
    (window as unknown as { played: string[] }).played = played;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      played.push(this.src);
      return Promise.resolve();
    };
  });
  const played = () => page.evaluate(() => (window as unknown as { played: string[] }).played.slice());
  const r = await rpc<{ id: string }>("routines.set", {
    name: "sound-probe",
    agent: "superagent",
    schedule: { kind: "manual" },
    action: "message",
    prompt: "Probe for the sounds",
    enabled: true,
  });
  let runs = 0;
  const runOnce = async () => {
    await rpc("routines.run", { routine: r.id });
    runs++;
    await until(
      async () =>
        (await rpc<{ runs: Array<{ state: string }> }>("routines.runs", { routine: r.id })).runs.filter(
          (x) => x.state !== "working",
        ).length >= runs,
    );
  };

  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page
    .getByRole("combobox", { name: "Buscar" })
    .or(page.getByRole("textbox", { name: "Buscar" }))
    .fill("sonidos");
  await page.getByRole("option", { name: /Sonidos/ }).click();
  const dialog = page.getByRole("dialog", { name: "Configuración" });
  await dialog.getByRole("radio", { name: "Pedidos" }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("apx.prefs") ?? "{}").noticeSound))
    .toBe("requests");
  await page.keyboard.press("Escape");

  // Only requests: the routine's news arrives without a sound.
  const before = (await played()).filter((src) => src.includes("message")).length;
  await runOnce();
  await page.waitForTimeout(1500);
  expect((await played()).filter((src) => src.includes("message")).length).toBe(before);

  // All notices: the next one sounds.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("apx.prefs") ?? "{}");
    localStorage.setItem("apx.prefs", JSON.stringify({ ...stored, noticeSound: "all" }));
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await page.waitForTimeout(1000);
  await runOnce();
  await expect.poll(async () => (await played()).filter((src) => src.includes("message")).length).toBeGreaterThan(0);
});
