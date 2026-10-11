// The chat's usage panel: its runs' tokens, and the auxiliary model's calls about it (its title), which no run holds.
import { expect, open, rpc, test, until } from "./kit.ts";

test("the usage panel shows the auxiliary model's tokens for the chat's title", async ({ page }) => {
  await rpc("setup.finish");
  const thread = await rpc<{ id: string }>("threads.create", { kind: "loose", agent_id: "roby" });
  await rpc("threads.send", { thread: thread.id, text: "Plan the Northwind launch" });
  // The title comes from the auxiliary model once the turn is done.
  await until(async () => {
    const { aux } = await rpc<{ aux: Array<{ purpose: string }> }>("usage.summary", { thread: thread.id });
    return aux.some((a) => a.purpose === "title");
  });
  await open(page, `#thread=${thread.id}&panel=usage`);
  const panel = page.getByRole("complementary", { name: "Panel lateral" });
  await expect(panel.getByText("Modelo auxiliar", { exact: true })).toBeVisible();
  await expect(panel.getByText("120 entrada · 8 salida · Título", { exact: true })).toBeVisible();
});
