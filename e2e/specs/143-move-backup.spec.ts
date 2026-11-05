// Move or back up: Settings downloads this setup as one file without secrets, and a copy brought in shows what it adds
// and what arrives off before anything changes; the same copy twice changes nothing.
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "../../apps/core/src/testkit/platform.ts";
import { expect, open, openSettings, rpc, test } from "./kit.ts";

type Exported = { file: Record<string, unknown> & { mcps: unknown[]; version: number } };

test("the owner downloads a copy, and brings one in after seeing what arrives off", async ({ page }) => {
  await rpc("setup.finish");
  await rpc("secrets.set", { name: "e2e_move_key", value: "tok-E2E-MOVE-5b7c9d1e3f" });
  const { file } = await rpc<Exported>("instance.export", { chats: false, rows: false });
  const dir = tempDir("apx-e2e-move-");
  try {
    // A copy from another computer: one server of its own whose key this computer does not have.
    const copy = path.join(dir.path, "apx-export.json");
    fs.writeFileSync(
      copy,
      JSON.stringify({
        ...file,
        mcps: [
          ...file.mcps,
          {
            name: "e2e-crm",
            command: "crm-mcp",
            args: [],
            env: { CRM_TOKEN: "secret://e2e_crm_key" },
            headers: {},
            enabled: true,
          },
        ],
      }),
    );
    const notes = path.join(dir.path, "notes.json");
    fs.writeFileSync(notes, "not a copy");

    await open(page);
    await openSettings(page);
    const dialog = page.getByRole("dialog", { name: "Configuración" });
    await dialog.getByRole("button", { name: "Mover o respaldar" }).click();
    await expect(dialog.getByRole("heading", { name: "Mover o respaldar" })).toBeVisible();

    // The download is the setup, and no secret value is in it.
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Descargar" }).click();
    const saved = await (await download).path();
    const text = fs.readFileSync(saved, "utf8");
    expect(JSON.parse(text).format).toBe("apx-instance");
    expect(text).not.toContain("tok-E2E-MOVE");

    const chooser = dialog.locator('input[type="file"]');
    await chooser.setInputFiles(copy);
    const preview = dialog.getByTestId("move-preview");
    await expect(preview.getByText("Llegan apagados")).toBeVisible();
    await expect(preview.getByText("e2e-crm")).toBeVisible();
    await expect(preview.getByText("e2e_crm_key")).toBeVisible();
    const servers = async () => (await rpc<{ servers: { name: string; enabled: boolean }[] }>("mcp.list")).servers;
    expect(
      (await servers()).some((s) => s.name === "e2e-crm"),
      "nothing changes before Import",
    ).toBe(false);

    await preview.getByRole("button", { name: /^Importar 1 cambio/ }).click();
    await expect(preview.getByRole("heading", { name: "Importado" })).toBeVisible();
    expect((await servers()).find((s) => s.name === "e2e-crm")?.enabled).toBe(false);

    // The same copy again: everything is already here.
    await chooser.setInputFiles(copy);
    await expect(dialog.getByText("Todo lo de este archivo ya está acá.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Importar/ })).toBeDisabled();

    // A file that is not a copy says so on the screen; one another version made is refused by the core.
    await chooser.setInputFiles(notes);
    await expect(dialog.getByRole("alert")).toHaveText("Este archivo está dañado o fue cambiado, y no se puede leer.");
    await expect(rpc("instance.preview_import", { file: { ...file, version: 2 } })).rejects.toThrow(/newer APX/);
  } finally {
    await rpc("mcp.set", { name: "e2e-crm", server: null });
    await dir.remove();
  }
});
