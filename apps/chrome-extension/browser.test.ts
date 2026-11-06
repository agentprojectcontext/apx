import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import test from "node:test";
import { expect } from "@playwright/test";
import { extensionBundle } from "./bundle.ts";
import { ICON_PATHS, ICON_SIZES } from "./icons.ts";
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY } from "./identity.ts";
import { capture, LONG_MODEL, withPanel } from "./testkit.ts";

for (const invalid of [0, -1, 65536, 1.5, Number.NaN]) {
  test(`invalid local port ${invalid} is refused`, () => {
    assert.throws(() => extensionBundle(invalid), /Choose a port/);
  });
}

test("the public manifest key derives the exact stable Chrome identity at every port", () => {
  assert.equal(EXTENSION_ID, "jiffjibeffjmombaholpgbnfdajpfigm");
  for (const port of [7440, 17440]) {
    const manifest = JSON.parse(extensionBundle(port)["manifest.json"] ?? "{}");
    assert.equal(manifest.key, EXTENSION_PUBLIC_KEY);
    const der = Buffer.from(manifest.key, "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    assert.equal(key.type, "public");
    assert.equal(key.asymmetricKeyType, "rsa");
    assert.equal(key.asymmetricKeyDetails?.modulusLength, 2048);
    const id = [...createHash("sha256").update(der).digest().subarray(0, 16)]
      .flatMap((byte) => [byte >> 4, byte & 15])
      .map((nibble) => String.fromCharCode(97 + nibble))
      .join("");
    assert.equal(id, EXTENSION_ID);
  }
});

test("the bundle includes raster APX icons in every declared Chrome size", () => {
  const bundle = extensionBundle();
  const manifest = JSON.parse(bundle["manifest.json"]);
  assert.deepEqual(manifest.icons, ICON_PATHS);
  assert.deepEqual(manifest.action.default_icon, ICON_PATHS);
  for (const size of ICON_SIZES) {
    const content = bundle[`assets/icon-${size}.png`];
    assert.ok(content instanceof Uint8Array);
    const png = Buffer.from(content);
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

for (const language of ["en", "es"] as const) {
  test(`${language}: real APX pairing, full model names, chat and recovery stay isolated`, async () => {
    await withPanel(
      language,
      false,
      async ({ core, client, page, frame, worker, token, llm, stopCore, restartCore }) => {
        const manifest = await worker.evaluate<{
          permissions: string[];
          icons: Record<string, string>;
          action: { default_icon: Record<string, string> };
          host_permissions?: unknown;
          content_scripts?: unknown;
          externally_connectable?: unknown;
        }>("chrome.runtime.getManifest()");
        // Tabs are reached only through the debugger in Chrome's APX group: no host access, no content scripts.
        assert.deepEqual(manifest.permissions, ["sidePanel", "nativeMessaging", "debugger", "tabs", "tabGroups"]);
        assert.deepEqual(manifest.icons, ICON_PATHS);
        assert.deepEqual(manifest.action.default_icon, ICON_PATHS);
        assert.equal(manifest.host_permissions, undefined);
        assert.equal(manifest.content_scripts, undefined);
        assert.equal(manifest.externally_connectable, undefined);
        assert.deepEqual(await worker.evaluate("chrome.sidePanel.getPanelBehavior()"), {
          openPanelOnActionClick: true,
        });
        const refusedOrigin = await fetch(`${core.url}/rpc/system.ping`, {
          method: "POST",
          headers: {
            origin: `chrome-extension://${new URL(worker.url()).hostname}`,
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: "{}",
        });
        assert.equal(refusedOrigin.status, 403);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await expect(frame.locator(".pair")).toBeVisible();
        const nav = await page.locator("nav").evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          background: getComputedStyle(document.documentElement).backgroundColor,
        }));
        assert.ok(nav.height <= 32);
        assert.equal(nav.background, "rgb(255, 255, 255)");
        const reload = page.getByRole("button", { name: language === "es" ? "Recargar" : "Reload", exact: true });
        await expect(reload).toBeVisible();
        await expect(page.getByText(/Not loading\?|¿No carga\?/)).toHaveCount(0);
        await expect(page.locator("#recovery")).toBeHidden();
        const frameTop = await page.locator("iframe").evaluate((element) => element.getBoundingClientRect().top);
        assert.equal(frameTop, nav.height);
        await expect(page.locator("details")).not.toHaveAttribute("open");
        await capture(page, frame, language, "pair");
        const code = (await client.call("devices.pair_start", {})).code;
        await frame.locator("input").fill(code);
        await frame.locator('button[type="submit"]').click();
        await expect(frame.locator("textarea")).toBeVisible();
        await expect(frame.locator(".quick__sub")).toHaveText("Home");
        await expect(frame.locator(".quick__head .is-online")).toBeVisible();
        await expect(frame.locator(".quick__offline")).toHaveCount(0);
        await expect(frame.locator("textarea")).toHaveAttribute(
          "placeholder",
          language === "es" ? "Escribile a APX…" : "Message APX…",
        );
        await capture(page, frame, language, "empty");
        const model = frame.locator(".composer__model");
        await model.click();
        await expect(frame.locator(".mchoice")).toBeVisible();
        await expect(frame.locator(".mchoice__fallback")).toHaveCount(2);
        await expect(frame.locator(".mchoice")).not.toContainText("Router");
        await expect(
          frame.getByRole("button", { name: language === "es" ? "Elegir automáticamente" : "Choose automatically" }),
        ).toBeVisible();
        await expect(frame.getByRole("searchbox")).toBeVisible();
        const option = frame.getByRole("option", { name: new RegExp(LONG_MODEL) });
        const label = option.locator(".mlist__name");
        const ref = option.locator(".mlist__ref");
        await expect(ref).toBeVisible();
        await expect(ref).toHaveText(`custom/${LONG_MODEL}`);
        for (const locator of [label, ref]) {
          const fits = await locator.evaluate(
            (element) =>
              element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
          );
          assert.equal(fits, true);
        }
        await option.click();
        await expect(model).toContainText(LONG_MODEL);
        const current = frame.locator(".mchoice__current");
        await expect(current).toContainText(LONG_MODEL);
        assert.equal(await current.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
        await capture(page, frame, language, "model-menu");
        await page.keyboard.press("Escape");
        await expect(frame.locator(".mchoice")).toBeHidden();
        // A truncated long name must not squeeze the menu's arrow into a dot.
        const arrow = await model.locator(".selectbtn__chevron").boundingBox();
        assert.ok(arrow && arrow.width >= 11, `model arrow is ${arrow?.width}px wide`);
        const stored = await client.call("threads.get", { thread: "home" });
        assert.equal(stored.thread.model_choice?.model, `custom/${LONG_MODEL}`);
        await frame.locator("textarea").fill("Check the isolated extension chat.");
        await frame.locator("textarea").press("Enter");
        const reply = frame.getByText("The isolated chat reached APX.", { exact: true });
        await expect(reply).toBeVisible({ timeout: 30000 });
        assert.ok(llm.calls.some((call) => call.models.includes(`custom/${LONG_MODEL}`)));
        const boundary = await page.evaluate(() => {
          let isolated = false;
          try {
            void document.querySelector("iframe")?.contentWindow?.document;
          } catch (error) {
            isolated = error instanceof DOMException && error.name === "SecurityError";
          }
          return { isolated, token: localStorage.getItem("apx.token"), query: location.search };
        });
        assert.deepEqual(boundary, { isolated: true, token: null, query: "" });
        const refused = await page.evaluate(async (url) => {
          try {
            await fetch(`${url}/rpc/system.ping`, { method: "POST", body: "{}" });
            return false;
          } catch {
            return true;
          }
        }, core.url);
        assert.equal(refused, true);
        await capture(page, frame, language, "conversation");
        await reload.click();
        await expect(reply).toBeVisible();
        await stopCore();
        await expect(frame.locator("textarea")).toBeDisabled();
        await expect(frame.locator(".quick__head .is-online")).toHaveCount(0);
        await expect(frame.locator(".quick__head .is-offline")).toBeVisible();
        await expect(frame.locator(".quick__offline")).toContainText(
          language === "es" ? "Sin conexión con APX" : "Not connected to APX",
        );
        await expect(model).toBeDisabled();
        await expect(model).toHaveText(language === "es" ? "No disponible" : "Unavailable");
        await capture(page, frame, language, "offline");
        const retried = page.waitForEvent("requestfailed", {
          predicate: (request) => request.url().endsWith("/rpc/system.health"),
        });
        await frame.locator(".quick__offline").getByRole("button").click();
        await retried;
        await expect(frame.locator(".quick__head .is-offline")).toBeVisible();
        await expect(frame.locator("textarea")).toBeDisabled();
        await restartCore();
        await expect(frame.locator(".quick__head .is-online")).toBeVisible({ timeout: 15000 });
        await expect(frame.locator(".quick__offline")).toHaveCount(0);
        await expect(frame.locator("textarea")).toBeEnabled();
        await expect(reply).toBeVisible();
        await capture(page, frame, language, "reconnected");
        await stopCore();
        await expect(frame.locator("textarea")).toBeDisabled();
        await reload.click();
        await expect(page.getByRole("link")).toBeVisible();
        await expect(page.getByText(/Not loading\?|¿No carga\?/)).toHaveCount(0);
        await expect(page.locator("details")).not.toHaveAttribute("open");
        await page.locator("summary").click();
        await expect(page.locator("#recovery")).toBeVisible();
        await expect(page.locator("#recovery")).toContainText(
          language === "es" ? "Asegurate de tener APX abierto" : "Make sure APX is open",
        );
        await capture(page, frame, language, "disconnected");
        await page.keyboard.press("Escape");
        await expect(page.locator("#recovery")).toBeHidden();
        await restartCore();
        await reload.click();
        await expect(reply).toBeVisible();
        await expect(frame.locator(".quick__head .is-online")).toBeVisible();
        assert.deepEqual(errors, []);
      },
    );
  });

  test(`${language}: an unconfigured APX explains that no models are connected`, async () => {
    await withPanel(language, true, async ({ client, page, frame }) => {
      await expect(frame.locator(".pair")).toBeVisible();
      await frame.locator("input").fill((await client.call("devices.pair_start", {})).code);
      await frame.locator('button[type="submit"]').click();
      await expect(frame.locator(".composer__model")).toContainText(language === "es" ? "Sin modelos" : "No models");
      await frame.locator(".composer__model").click();
      await expect(frame.locator(".mlist__effort")).toHaveCount(0);
      await expect(frame.locator(".mlist__empty")).toHaveText(
        language === "es"
          ? "Todavía no hay modelos disponibles. Conectá un servicio en APX."
          : "No models available yet. Connect a service in APX.",
      );
      await expect(frame.getByRole("option")).toHaveCount(0);
      await expect(frame.locator(".mchoice__fallback")).toHaveCount(0);
      await expect(frame.getByRole("searchbox")).toHaveCount(0);
      await capture(page, frame, language, "no-models");
    });
  });
}
