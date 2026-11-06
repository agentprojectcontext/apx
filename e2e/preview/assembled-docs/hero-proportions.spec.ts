import { expect, test } from "./site.fixture.ts";

for (const lang of ["en", "es"]) {
  for (const motion of ["reduce", "no-preference"] as const) {
    test(`the ${lang} hero keeps every agent square with ${motion} motion`, async ({
      page,
      assembledOrigin,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.clock.install({ time: new Date("2025-01-01T00:00:00Z") });
      await page.clock.pauseAt(new Date("2025-01-01T01:00:00Z"));
      await page.goto(`${assembledOrigin}${lang === "es" ? "/es/" : "/"}`);
      await expect(page.locator("#word")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const agents = page.locator("#heroBlob .apx-blob");
      await expect(agents).toHaveCount(5);
      const words = await page
        .locator("#word")
        .evaluate((el) => JSON.parse(el.getAttribute("data-words") ?? "[]") as string[]);
      const count = motion === "reduce" ? 1 : await agents.count();
      for (let i = 0; i < count; i++) {
        if (i > 0) await page.clock.fastForward(2600);
        const word = words[i];
        if (!word) throw new Error("Each hero agent needs its matching word");
        await expect(page.locator("#word")).toHaveText(word);
        const active = page.locator("#heroBlob .apx-blob.on");
        await expect(active).toHaveCount(1);
        await expect(agents.nth(i)).toHaveClass(/\bon\b/);
        await expect
          .poll(() =>
            active
              .locator("img")
              .evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0),
          )
          .toBe(true);
        for (const time of [0, 275, 550]) {
          const boxes = await active.evaluate((el, currentTime) => {
            for (const animation of el.getAnimations()) {
              animation.pause();
              animation.currentTime = currentTime;
            }
            const box = (node: Element) => {
              const rect = node.getBoundingClientRect();
              return { width: rect.width, height: rect.height, x: rect.x, y: rect.y };
            };
            const slot = el.parentElement;
            const body = el.querySelector("img");
            const eyes = el.querySelector("svg");
            if (!slot || !body || !eyes) throw new Error("The hero agent needs its square slot, body and eyes");
            return {
              slot: box(slot),
              body: box(body),
              eyes: box(eyes),
              width: (el as HTMLElement).offsetWidth,
              height: (el as HTMLElement).offsetHeight,
            };
          }, time);
          expect(Math.abs(boxes.width - boxes.height)).toBeLessThanOrEqual(1);
          expect(Math.abs(boxes.body.width - boxes.body.height)).toBeLessThan(0.1);
          expect(boxes.body.width).toBeGreaterThan(0);
          for (const key of ["width", "height", "x", "y"] as const)
            expect(Math.abs(boxes.body[key] - boxes.eyes[key])).toBeLessThan(0.1);
          if (time === 550) expect(Math.abs(boxes.body.width - boxes.slot.width)).toBeLessThan(0.1);
        }
        if (i === 0 || i === 2) {
          await page.locator("#word").evaluate((el) => {
            for (const animation of el.getAnimations()) {
              animation.pause();
              animation.currentTime = 1000;
            }
          });
          const path = testInfo.outputPath(`hero-${lang}-${i}.png`);
          await page.screenshot({ path });
          await testInfo.attach(`hero-${lang}-${i}`, { path, contentType: "image/png" });
        }
      }
      if (motion === "reduce") {
        await page.clock.fastForward(13_000);
        const firstWord = words[0];
        if (!firstWord) throw new Error("The hero needs an initial word");
        await expect(page.locator("#word")).toHaveText(firstWord);
      }
    });
  }
}
