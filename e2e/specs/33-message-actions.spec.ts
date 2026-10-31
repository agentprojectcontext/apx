// Each bubble's own controls, shown on hover: copy its words, fork the chat from it into a new one, and read it aloud
// (crossed out while no voice is set up).
import { expect, open, rpc, test } from "./kit.ts";

test("a bubble copies, forks the chat from it and says when there is no voice to read it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await rpc("setup.finish", {});
  // No voice for this test: the voice imported from v1 by the setup spec is switched off, then back on at the end.
  type Voice = { id: string; enabled: boolean; key_set?: boolean; status?: string } & Record<string, unknown>;
  const voices = (await rpc<{ services: Voice[] }>("services.list", { kind: "speech" })).services.filter(
    (v) => v.enabled,
  );
  const switchVoices = (enabled: boolean) =>
    Promise.all(
      voices.map(({ id, key_set: _k, status: _s, ...service }) =>
        rpc("services.set", { id, service: { ...service, enabled } }),
      ),
    );
  await switchVoices(false);
  try {
    const t = await rpc<{ id: string }>("threads.create", {
      kind: "loose",
      agent_id: "superagent",
      title: "Acme plan",
    });
    await open(page, `#view=inbox&thread=${t.id}`);
    const main = page.getByRole("main");
    const box = page.getByRole("textbox", { name: /^Escribile a/ });
    for (const text of ["Northwind uno", "Northwind dos"]) {
      await box.fill(text);
      await box.press("Enter");
      await expect(main.locator("p", { hasText: `Got it: ${text}` })).toBeVisible();
    }

    // Copy: the words of that bubble.
    const answer = main.locator(".apx-msg--agent", { hasText: "Got it: Northwind uno" });
    await answer.hover();
    await answer.getByRole("button", { name: "Copiar" }).click();
    await expect(answer.getByRole("button", { name: "Copiado" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Got it: Northwind uno");

    // No voice set up: read aloud is there, crossed out.
    await expect(answer.getByRole("button", { name: "Leer en voz alta" })).toHaveAttribute("aria-disabled", "true");

    // Fork at the first answer: a new chat with it, without what came after.
    await answer.getByRole("button", { name: "Bifurcar en un chat nuevo" }).click();
    await expect(page).not.toHaveURL(new RegExp(`thread=${t.id}`));
    await expect(page.locator(".chat__titles", { hasText: "Acme plan (bifurcación)" })).toBeVisible();
    await expect(main.locator("p", { hasText: "Got it: Northwind uno" })).toBeVisible();
    await expect(main.getByText("Northwind dos")).toHaveCount(0);

    // Fork at the owner's message: up to just before it, its words ready in the new chat's composer.
    await open(page, `#view=inbox&thread=${t.id}`);
    const mine = main.locator(".apx-msg--user", { hasText: "Northwind dos" });
    await mine.hover();
    // The owner's own words are not read aloud.
    await expect(mine.getByRole("button", { name: "Leer en voz alta" })).toHaveCount(0);
    await mine.getByRole("button", { name: "Bifurcar en un chat nuevo" }).click();
    await expect(page).not.toHaveURL(new RegExp(`thread=${t.id}`));
    await expect(main.getByText("Got it: Northwind dos")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /^Escribile a/ })).toHaveValue("Northwind dos");
  } finally {
    await switchVoices(true);
  }
});
