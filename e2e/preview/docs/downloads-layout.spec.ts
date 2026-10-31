import { expect, test } from "@playwright/test";

// The terminal install and the server guide pair up on wide screens; the unsigned-apps steps get one column per
// system; the system picker stays on one line on a phone with every label inside its button.
for (const pre of ["", "/es"]) {
  test(`${pre || "en"}: download section layout`, async ({ page }, testInfo) => {
    await page.goto(`${pre}/`);
    const pair = page.locator(".dl-pair");
    await pair.scrollIntoViewIfNeeded();
    const [cli, server] = await Promise.all([
      pair.locator(".cli").boundingBox(),
      pair.locator(".dl-server").boundingBox(),
    ]);
    if (!cli || !server) throw new Error("the terminal and server cards must render");
    if (testInfo.project.name === "desktop") expect(Math.abs(cli.y - server.y)).toBeLessThan(2);
    else expect(server.y).toBeGreaterThan(cli.y + cli.height - 1);
    await expect(page.locator(".dl-unsigned__cols > dl")).toHaveCount(3);
    for (const width of [360, 390])
      if (testInfo.project.name === "phone") {
        await page.setViewportSize({ width, height: 844 });
        const fit = await page.locator(".cli__tabs button").evaluateAll((buttons) =>
          buttons.map((button) => {
            const range = document.createRange();
            range.selectNodeContents(button);
            const text = range.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return { top: Math.round(box.top), inside: text.left >= box.left - 1 && text.right <= box.right + 1 };
          }),
        );
        expect(new Set(fit.map((b) => b.top)).size).toBe(1);
        expect(fit.every((b) => b.inside)).toBe(true);
      }
  });
}
