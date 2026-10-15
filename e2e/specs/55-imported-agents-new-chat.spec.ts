// New chat inside a project with agents imported into it (copied from another project, or installed from a template):
// it opens with the agent picked and stays, as it does for an agent the project made itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

type Agent = { id: string; name: string; kind: string; project_id?: string };

function repoWith(...agents: Array<[string, string]>): string {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-import-")));
  const dir = path.join(repo, ".apc", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  for (const [slug, name] of agents)
    fs.writeFileSync(path.join(dir, `${slug}.md`), `---\nname: ${name}\nrole: Helper\n---\n\nHelps.\n`);
  return repo;
}

/** A project that already has a chat with the super-agent: the one a stray guard would fall back to. */
async function projectWithEarlierChat(...agents: Array<[string, string]>): Promise<string> {
  const id = (await rpc<{ project: { id: string } }>("projects.register", { path: repoWith(...agents) })).project.id;
  const superAgent = (await rpc<{ agents: Agent[] }>("agents.list")).agents.find((a) => a.kind === "secretary");
  const earlier = await rpc<{ id: string }>("threads.create", {
    kind: "loose",
    agent_id: superAgent?.id,
    project_id: id,
    title: "Earlier",
  });
  await rpc("threads.send", { thread: earlier.id, text: "Hello there" });
  return id;
}

async function newChatWith(page: import("@playwright/test").Page, project: string, name: string, id: string) {
  await open(page, `#project=${project}&tab=chats`);
  await page.getByRole("combobox", { name: "Nuevo chat" }).first().click();
  await page
    .getByRole("option", { name: new RegExp(name) })
    .first()
    .click();
  const box = page.getByRole("textbox", { name: `Escribile a ${name}…` });
  await expect(box).toBeVisible();
  await expect(page).toHaveURL(/thread=new/);
  // Still there a moment later: nothing swaps the new chat for the project's latest one.
  await page.waitForTimeout(500);
  await expect(box).toBeVisible();

  await box.fill("Hello from a copy");
  await box.press("Enter");
  await expect(page.getByRole("main").locator("p", { hasText: "Got it: Hello from a copy" })).toBeVisible();
  const made = (
    await rpc<{ threads: Array<{ agent_ids: string[]; title: string }> }>("threads.list", {
      project_id: project,
    })
  ).threads.filter((t) => t.agent_ids[0] === id);
  expect(made).toHaveLength(1);
}

test("a new chat with an agent copied from another project opens and is made with its first message", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  await projectWithEarlierChat(["zeta", "Zeta"]);
  const target = await projectWithEarlierChat(["boss", "Boss"]);
  const zeta = (await rpc<{ agents: Agent[] }>("agents.list")).agents.find((a) => a.name === "Zeta");
  const copy = await rpc<{ cloned: Agent[] }>("agents.clone", {
    agents: [zeta?.id],
    project_id: target,
    rename: false,
  });
  expect(copy.cloned.map((a) => a.project_id)).toEqual([target]);

  await newChatWith(page, target, "Zeta", copy.cloned[0]?.id ?? "");
});

test("a new chat with an agent installed from a template opens and is made with its first message", async ({
  page,
}) => {
  await rpc("setup.finish", {});
  const target = await projectWithEarlierChat(["boss", "Boss"]);
  const { singles } = await rpc<{ singles: Array<{ id: string; name: string }> }>("agents.templates");
  const single = singles[0];
  expect(single).toBeTruthy();
  const done = await rpc<{ installed: Agent[] }>("agents.install", { project_id: target, templates: [single?.id] });
  expect(done.installed).toHaveLength(1);

  await newChatWith(page, target, done.installed[0]?.name ?? "", done.installed[0]?.id ?? "");
});
