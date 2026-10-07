// A project's repository from Files → Git: what changed, staging it, committing it, and the history.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

test("changes are staged and committed from the Git view, and the commit opens from the history", async ({ page }) => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-git-")));
  const sh = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
  sh("init", "-q", "-b", "main");
  sh("config", "user.name", "Acme Dev");
  sh("config", "user.email", "dev@example.com");
  sh("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind shop\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feat: first");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind shop\n\nShips on Fridays.\n");
  const { project } = await rpc<{ project: { id: string } }>("projects.register", { path: repo });

  try {
    await open(page, `#project=${project.id}&tab=files`);
    await page.getByRole("radio", { name: "Git" }).click();
    const side = page.getByRole("navigation", { name: "Control de versiones" });
    await side.getByTitle("AGENTS.md", { exact: true }).click();
    await expect(page.getByText("Ships on Fridays.")).toBeVisible();

    await side.getByRole("button", { name: "Preparar todo" }).click();
    await expect(side.getByText("Preparados")).toBeVisible();
    await side.getByRole("textbox", { name: /Mensaje del commit/ }).fill("docs: shipping day");
    await side.getByRole("button", { name: "Confirmar" }).click();
    await expect(side.getByText("Sin cambios por confirmar.")).toBeVisible();

    await side.getByRole("button", { name: /docs: shipping day/ }).click();
    const detail = page.getByRole("region", { name: "Detalle del cambio" });
    await detail.getByTitle("AGENTS.md", { exact: true }).click();
    await expect(detail.getByText("Ships on Fridays.")).toBeVisible();
  } finally {
    await rpc("projects.unregister", { project: project.id });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
