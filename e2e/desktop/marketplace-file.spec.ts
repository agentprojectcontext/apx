import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { ALL_SLIDES } from "../../apps/web/src/shell/welcomeFilm.ts";
import type { ExtensionInfo } from "../../packages/protocol/src/index.ts";
import { rpc, until } from "../specs/kit.ts";
import { launchDesktop } from "./app-shell.test-support.ts";

test("a host file setting handles cancel, invalid SQLite and replacement without displaying the path", async ({
  baseURL,
}, info) => {
  const sandbox = tempDir("apx-e2e-file-");
  const file = path.join(sandbox.path, "backup.sqlite");
  const source = path.join(sandbox.path, "extension");
  fs.mkdirSync(source);
  fs.writeFileSync(
    path.join(source, "apx-extension.json"),
    JSON.stringify({
      manifest: 2,
      id: "file_review",
      name: "File review",
      version: "1.0.0",
      settings: [
        {
          name: "backup",
          label: "SQLite backup",
          locales: { es: { label: "Copia SQLite" } },
          type: "file",
          fileFormat: "sqlite",
          required: true,
        },
      ],
    }),
  );
  await info.attach("runtime-health", {
    body: JSON.stringify(await rpc("system.health")),
    contentType: "application/json",
  });
  const seen = await rpc<ExtensionInfo>("extensions.inspect", { path: source });
  await rpc("extensions.install", { path: source, hash: seen.hash });
  const app = await launchDesktop(sandbox.path);
  try {
    const core = baseURL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 7460}`;
    const page = await until(async () =>
      app.windows().find((p) => p.url().startsWith(core) && !p.url().includes("quick=1")),
    );
    for (const language of ["en", "es"] as const) {
      await page.evaluate(
        ({ language, seen }) => {
          localStorage.setItem("apx.corner", JSON.stringify({ discord: true, star: true, welcomeSeen: seen }));
          localStorage.setItem("apx.prefs", JSON.stringify({ language, panelMode: "advanced" }));
        },
        { language, seen: ALL_SLIDES },
      );
      await page.goto(`${core}/#view=marketplace&section=mine&item=ext%3Afile_review`);
      await page.reload();
      await page
        .getByRole("button", { name: language === "en" ? "Connect" : "Conectar", exact: true })
        .first()
        .click();
      const choose = page.getByRole("button", {
        name: language === "en" ? "SQLite backup: Choose backup" : "Copia SQLite: Elegir copia",
        exact: true,
      });
      await expect(choose).toBeVisible();
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await choose.click();
      await expect(choose).toBeVisible();
      fs.rmSync(file, { force: true });
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
      await choose.click();
      await page
        .getByRole("button", { name: language === "en" ? "Connect" : "Conectar", exact: true })
        .last()
        .click();
      const missing =
        language === "en"
          ? "We couldn’t find that file. Choose an existing copy."
          : "No encontramos ese archivo. Elegí una copia que ya exista.";
      await expect(page.getByText(missing, { exact: true })).toBeVisible();
      fs.writeFileSync(file, "invalid");
      await page
        .getByRole("button", {
          name: language === "en" ? "SQLite backup: Change backup" : "Copia SQLite: Cambiar copia",
          exact: true,
        })
        .click();
      await expect(page.getByText(missing, { exact: true })).toHaveCount(0);
      await page
        .getByRole("button", { name: language === "en" ? "Connect" : "Conectar", exact: true })
        .last()
        .click();
      const message =
        language === "en"
          ? "We couldn’t open this file as a SQLite database. Choose a valid SQLite backup."
          : "No pudimos abrir este archivo como una base SQLite. Elegí una copia válida.";
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(page.getByText(file, { exact: true })).toHaveCount(0);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.screenshot({ path: info.outputPath(`file-${language}-${width}-invalid.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 844 });
      fs.unlinkSync(file);
      const db = new DatabaseSync(file);
      db.exec("CREATE TABLE sample (id INTEGER)");
      db.close();
      await page
        .getByRole("button", {
          name: language === "en" ? "SQLite backup: Change backup" : "Copia SQLite: Cambiar copia",
          exact: true,
        })
        .click();
      await expect(page.getByText(message, { exact: true })).toHaveCount(0);
      await expect(page.getByText(language === "en" ? "Not connected" : "Sin conectar", { exact: true })).toBeVisible();
      await expect(page.getByText("backup.sqlite", { exact: true })).toBeVisible();
      await app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      });
      await page
        .getByRole("button", {
          name: language === "en" ? "SQLite backup: Change backup" : "Copia SQLite: Cambiar copia",
          exact: true,
        })
        .click();
      await expect(page.getByText("backup.sqlite", { exact: true })).toBeVisible();
      if (language === "es") {
        const bytes = fs.readFileSync(file);
        await page.getByRole("button", { name: "Conectar", exact: true }).last().click();
        await expect(page.getByRole("button", { name: "Listo", exact: true })).toBeVisible();
        expect(fs.readFileSync(file).equals(bytes)).toBe(true);
        await page.screenshot({ path: info.outputPath("file-es-connected.png") });
        await page.getByRole("button", { name: "Listo", exact: true }).click();
        continue;
      }
      await page
        .getByRole("button", { name: language === "en" ? "Close" : "Cerrar", exact: true })
        .last()
        .click();
    }
  } finally {
    await app.close();
    await rpc("extensions.remove", { id: "file_review" });
    sandbox.remove();
  }
});
