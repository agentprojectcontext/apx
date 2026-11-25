import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test, world } from "./kit.ts";

test.use({
  expectedConsoleErrors: [
    {
      path: "/rpc/agents.migrate",
      text: "Failed to load resource: the server responded with a status of 409 (Conflict)",
    },
  ],
});

for (const width of [1280, 390]) {
  test(`an agent and selected files move after review at ${width}px, without cloning`, async ({ page }, info) => {
    await rpc("setup.finish", {});
    await page.setViewportSize({ width, height: 900 });
    const sandbox = await world.info();
    const root = path.join(sandbox.dir, `agent-move-${width}`);
    const sourceRoot = path.join(root, "acme");
    const targetRoot = path.join(root, "northwind");
    for (const folder of [sourceRoot, targetRoot]) {
      fs.mkdirSync(path.join(folder, ".agent", "agents"), { recursive: true });
      fs.writeFileSync(path.join(folder, "AGENTS.md"), "# Example project\n");
      fs.writeFileSync(
        path.join(folder, ".agent", "project.json"),
        JSON.stringify({ name: `${path.basename(folder)} ${width}` }),
      );
    }
    const definition = "---\nname: Researcher\nrole: Research\n---\n\nKeep the evidence.\n";
    fs.writeFileSync(path.join(sourceRoot, ".agent", "agents", "researcher.md"), definition);
    fs.mkdirSync(path.join(sourceRoot, "reports"));
    fs.writeFileSync(path.join(sourceRoot, "reports", "result.txt"), "Example findings");
    const { project: source } = await rpc<{ project: { id: string } }>("projects.register", { path: sourceRoot });
    const { project: target } = await rpc<{ project: { id: string } }>("projects.register", { path: targetRoot });
    const { agents } = await rpc<{ agents: Array<{ id: string; slug: string }> }>("agents.list", {
      project_id: source.id,
    });
    const agent = agents.find((a) => a.slug === "researcher");
    expect(agent).toBeTruthy();

    await open(page, `#project=${source.id}&tab=team`);
    await page.getByRole("button", { name: "Ver: Researcher", exact: true }).click();
    await page.getByRole("button", { name: "Mover a otro proyecto", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Mover a Researcher", exact: true });
    await expect(dialog.getByRole("button", { name: "Revisar traslado" })).toBeDisabled();
    await dialog.getByRole("combobox", { name: "Proyecto de destino" }).click();
    await page.getByRole("option", { name: `northwind ${width}`, exact: true }).click();
    await dialog.getByRole("checkbox", { name: "reports", exact: true }).check();
    await dialog.getByRole("button", { name: "Revisar traslado" }).click();
    await expect(dialog.getByRole("heading", { name: `acme ${width} → northwind ${width}` })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Mover agente y trabajo" })).toBeDisabled();
    expect(fs.existsSync(path.join(sourceRoot, "reports", "result.txt"))).toBe(true);
    await dialog.screenshot({ path: info.outputPath(`review-${width}.png`) });

    fs.writeFileSync(path.join(sourceRoot, "reports", "result.txt"), "Updated example findings");
    const stale = page.waitForResponse(
      (response) => response.url().endsWith("/rpc/agents.migrate") && response.status() === 409,
    );
    await dialog
      .getByRole("checkbox", { name: `Mover a Researcher y el trabajo revisado a northwind ${width}.` })
      .check();
    await dialog.getByRole("button", { name: "Mover agente y trabajo" }).click();
    expect((await stale).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(fs.existsSync(path.join(sourceRoot, ".agent", "agents", "researcher.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetRoot, "reports", "result.txt"))).toBe(false);
    await dialog.getByRole("button", { name: "Revisar traslado" }).click();
    await expect(dialog.getByRole("heading", { name: `acme ${width} → northwind ${width}` })).toBeVisible();

    await dialog
      .getByRole("checkbox", { name: `Mover a Researcher y el trabajo revisado a northwind ${width}.` })
      .check();
    await dialog.getByRole("button", { name: "Mover agente y trabajo" }).click();
    await expect(page).toHaveURL(new RegExp(`project=${target.id}&tab=team`));
    await expect(page.getByRole("button", { name: "Ver: Researcher", exact: true })).toBeVisible();
    expect(fs.readFileSync(path.join(targetRoot, ".agent", "agents", "researcher.md"), "utf8")).toBe(definition);
    expect(fs.readFileSync(path.join(targetRoot, "reports", "result.txt"), "utf8")).toBe("Updated example findings");
    expect(fs.existsSync(path.join(sourceRoot, ".agent", "agents", "researcher.md"))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, "reports", "result.txt"))).toBe(false);
    const moved = await rpc<{ agents: Array<{ id: string; project_id?: string }> }>("agents.list", {});
    expect(moved.agents.filter((a) => a.id === agent?.id)).toEqual([
      expect.objectContaining({ project_id: target.id }),
    ]);
    await page.screenshot({ path: info.outputPath(`destination-${width}.png`) });
  });
}
