import assert from "node:assert/strict";
import { test } from "node:test";
import { type BrowserContext, chromium, expect } from "@playwright/test";
import { publicArtifactCode, publicArtifactCopy } from "../apps/core/src/domain/public-artifact-copy.ts";
import { createPublicArtifactCloud } from "../apps/core/src/public-artifacts/cloud.ts";
import { browserCloud } from "./browser-cloud.ts";

const viewer = process.env.APX_ARTIFACT_VIEWER_URL;
if (!viewer) throw new Error("Run through pnpm test:firebase");
const shots = process.env.APX_SHOTS_DIR;
const WEB_KEY = "demo-web-key-for-browser-tests";

function copy(title: string) {
  return publicArtifactCopy(
    { name: "tank", title, version: 1, app: false, html: "<main><h1>Pocket aquarium</h1></main>", state: {} },
    [],
  );
}

/** A Google session Firebase kept from an earlier visit, as its web SDK stores it; its account lookup is answered here. */
async function keptSession(context: BrowserContext, who: { uid: string; token: string }) {
  const email = `${who.uid}@example.com`;
  await context.route("https://identitytoolkit.googleapis.com/**", (route) =>
    route.fulfill({
      json: { users: [{ localId: who.uid, email, displayName: "Northwind Owner", providerUserInfo: [] }] },
    }),
  );
  await context.addInitScript(
    ({ key, user }) => {
      localStorage.setItem("apx-signed-in", "1");
      const open = indexedDB.open("firebaseLocalStorageDb", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
      open.onsuccess = () =>
        open.result
          .transaction("firebaseLocalStorage", "readwrite")
          .objectStore("firebaseLocalStorage")
          .put({
            fbase_key: key,
            value: { ...user, stsTokenManager: { ...user.stsTokenManager, expirationTime: Date.now() + 3_600_000 } },
          });
    },
    {
      key: `firebase:authUser:${WEB_KEY}:[DEFAULT]`,
      user: {
        uid: who.uid,
        email,
        emailVerified: true,
        displayName: "Northwind Owner",
        isAnonymous: false,
        providerData: [],
        stsTokenManager: { refreshToken: "kept", accessToken: who.token, expirationTime: 0 },
        createdAt: "0",
        lastLoginAt: "0",
        apiKey: WEB_KEY,
        appName: "[DEFAULT]",
      },
    },
  );
}

for (const width of [1280, 390]) {
  test(`the owner, signed in with Google, copies the link and stops sharing from the public page at ${width}px`, async () => {
    const owner = browserCloud(`owner-${width}`);
    const cloud = createPublicArtifactCloud({ fetch: owner.fetch });
    const code = publicArtifactCode();
    await cloud.publish({ uid: owner.uid, idToken: owner.token }, code, copy("Pocket aquarium"));
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width, height: 760 },
        locale: "es-AR",
        colorScheme: width > 600 ? "dark" : "light",
      });
      await keptSession(context, owner);
      const page = await context.newPage();
      await page.goto(`${viewer}/${code}`);
      await expect(page).toHaveTitle("Pocket aquarium · APX");
      if (width > 600) await expect(page.getByRole("button", { name: "Editar en APX" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Descargar APX" })).toHaveCount(0);
      await page.getByRole("button", { name: "Opciones de la copia" }).click();
      await expect(page.getByRole("menu").getByText("Esta copia es tuya")).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Copiar enlace" })).toBeVisible();
      if (shots) await page.screenshot({ path: `${shots}/owner-menu-${width}.png` });
      await page.getByRole("menuitem", { name: "Dejar de compartir…" }).click();
      await expect(page.getByRole("dialog")).toContainText("¿Dejar de compartir Pocket aquarium?");
      if (shots) await page.screenshot({ path: `${shots}/owner-stop-${width}.png` });
      await page.getByRole("button", { name: "Dejar de compartir" }).click();
      await expect(page.getByRole("heading", { name: "Dejaste de compartir esta copia" })).toBeVisible();
      if (shots) await page.screenshot({ path: `${shots}/owner-stopped-${width}.png` });
      assert.equal((await fetch(`${viewer}/${code}`)).status, 404);
    } finally {
      await browser.close();
    }
  });
}

test("a visitor can sign in, download APX, and is told when APX did not open; someone else's copy shows no owner options", async () => {
  const owner = browserCloud("owner-1280");
  const stranger = browserCloud("stranger");
  const cloud = createPublicArtifactCloud({ fetch: owner.fetch });
  const code = publicArtifactCode();
  await cloud.publish({ uid: owner.uid, idToken: owner.token }, code, copy("Weekly plan"));
  const browser = await chromium.launch({ headless: true });
  try {
    const visitor = await browser.newContext({ viewport: { width: 1280, height: 760 }, locale: "es-AR" });
    const page = await visitor.newPage();
    await page.goto(`${viewer}/${code}`);
    await expect(page.getByRole("button", { name: "Descargar APX" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Página de APX" })).toHaveAttribute("href", "https://apxagent.app");
    await page.getByRole("button", { name: "Opciones de la copia" }).click();
    await expect(page.getByRole("menuitem", { name: "Iniciar sesión con Google" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Dejar de compartir/ })).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/visitor-menu-1280.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Abrir en APX" }).click();
    await expect(page.getByRole("status")).toContainText("¿No se abrió?");
    if (shots) await page.screenshot({ path: `${shots}/visitor-not-opened-1280.png` });

    const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, locale: "es-AR" });
    const small = await phone.newPage();
    await small.goto(`${viewer}/${code}`);
    await expect(small.getByRole("button", { name: "Descargar APX" })).toHaveCount(0);
    await small.getByRole("button", { name: "Opciones de la copia" }).click();
    await expect(small.getByRole("menuitem", { name: "Descargar APX" })).toBeVisible();
    await expect(small.getByRole("menuitem", { name: "Iniciar sesión con Google" })).toBeVisible();
    if (shots) await small.screenshot({ path: `${shots}/visitor-menu-390.png` });

    const other = await browser.newContext({ viewport: { width: 1280, height: 760 }, locale: "es-AR" });
    await keptSession(other, stranger);
    const theirs = await other.newPage();
    await theirs.goto(`${viewer}/${code}`);
    await theirs.getByRole("button", { name: "Opciones de la copia" }).click();
    await expect(theirs.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();
    await expect(theirs.getByRole("menu").getByText(/Esta copia es tuya|Dejar de compartir/)).toHaveCount(0);
    await expect(theirs.getByRole("button", { name: "Abrir en APX" })).toBeVisible();
  } finally {
    await browser.close();
  }
});
