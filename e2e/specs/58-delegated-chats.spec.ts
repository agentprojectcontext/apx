// The chats an agent delegates hang under the chat it delegated from in the chat list, folded until opened. One delegated into a project from Home is listed in that project too, with a way back to Home.
import type { Thread } from "../../packages/protocol/src/domain.ts";
import { expect, open, rpc, test } from "./kit.ts";

test("delegated chats nest under Home, unfold, open, and show in the project they work in", async ({ page }) => {
  await rpc("setup.finish", {});
  const { project } = await rpc<{ project: { id: string } }>("projects.create", { name: "Northwind ops" });
  await rpc("threads.send", { thread: "home", text: "start a worker in " + project.id });
  let sub: Thread | undefined;
  await expect
    .poll(async () => {
      const { threads } = await rpc<{ threads: Thread[] }>("threads.list", { root_thread: "home" });
      sub = threads.find((t) => t.project_id === project.id);
      return sub?.state;
    })
    .toBe("idle");
  const subId = sub?.id ?? "";
  const subTitle = "Researcher: check the project sources";

  await open(page, "#");
  const list = page.locator(".inbox__list");
  const nested = list.locator(".delegated__list .tree__session", { hasText: subTitle });
  const group = list.locator('.delegated[data-thread="home"]');
  const fold = group.getByRole("button", { name: /^(Ver|Ocultar) los chats que delegó$/ });
  // Folded until the owner opens it, and listed only under Home, never as a row of its own.
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(nested).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(nested).toHaveCount(1);
  await expect(list.getByText(subTitle)).toHaveCount(1);
  await expect(group.locator(".delegated__list")).toContainText(subTitle);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(nested).toHaveCount(0);
  await fold.click();
  await nested.click();
  await expect(page).toHaveURL(new RegExp(`thread=${subId}`));

  // In the project it works in, it is listed with where it came from; that link goes back to Home.
  await open(page, `#project=${project.id}&tab=chats`);
  await expect(page.getByRole("tab", { name: "Chats 1", exact: true })).toBeVisible();
  await expect(list.getByText(subTitle)).toHaveCount(1);
  await list.locator(".delegated.is-alone", { hasText: subTitle }).locator(".delegated__from").click();
  await expect(page).toHaveURL(/^[^#]*#thread=home$/);
});
