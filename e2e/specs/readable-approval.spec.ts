import { expect, open, rpc, test } from "./kit.ts";

for (const language of ["en", "es"] as const) {
  for (const width of [1280, 390]) {
    test(`a readable approval uses the page scroll and keeps completed wording (${language}, ${width})`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((language) => localStorage.setItem("apx.prefs", JSON.stringify({ language })), language);
      await rpc("setup.finish", {});
      const original = await rpc<{ agent: { autonomy?: string } }>("agents.get", { agent: "superagent" });
      await rpc("owner.set", { about: "" });
      await rpc("agents.update", { agent: "superagent", autonomy: "manual" });
      try {
        const chat = await rpc<{ id: string }>("threads.create", {
          kind: "loose",
          agent_id: "superagent",
          title: "Northwind review",
        });
        await open(page, `#thread=${chat.id}`);
        await page
          .getByRole("textbox", { name: language === "es" ? /Escribile/ : /Message/ })
          .fill("review my profile note");
        await page.keyboard.press("Enter");
        const card = page.locator(".inputcard.is-pending");
        const description = card.locator(".inputcard__description");
        await expect(description).toContainText("<button>Review</button>");
        await expect(description.locator("button")).toHaveCount(0);
        const metrics = await description.evaluate((el) => ({
          height: el.clientHeight,
          scroll: el.scrollHeight,
          font: getComputedStyle(el).fontFamily,
          maxHeight: getComputedStyle(el).maxHeight,
        }));
        expect(metrics.scroll).toBeLessThanOrEqual(metrics.height + 1);
        expect(metrics.font).not.toContain("mono");
        expect(metrics.maxHeight).toBe("none");
        await page.screenshot({ path: info.outputPath("pending.png"), fullPage: true });
        await card
          .getByRole("button", { name: language === "es" ? "Aceptar una vez" : "Approve once", exact: true })
          .click();
        const settled = page.locator(".inputline").filter({ hasText: language === "es" ? "Aprobado" : "Approved" });
        await settled.getByRole("button").first().click();
        await expect(settled.locator(".inputcard__description")).toContainText("Northwind delivery review");
        await expect(settled.locator(".inputcard__prompt")).toHaveCount(0);
        await expect(settled).not.toContainText(language === "es" ? "necesita tu OK" : "needs your OK");
        await page.screenshot({ path: info.outputPath("completed.png"), fullPage: true });
      } finally {
        await rpc("agents.update", { agent: "superagent", autonomy: original.agent.autonomy ?? null });
        await rpc("owner.set", { about: "" });
      }
    });
  }
}
