// The new-chat picker from the Inbox: its search row looks like part of the menu before any settings screen loaded,
// and letters typed after it opens go to the search, never jump between agents.
import { expect, open, test } from "./kit.ts";

test("the new-chat search is styled on first open and takes what is typed, opened by keyboard too", async ({
  page,
}) => {
  await open(page);
  const trigger = page.getByRole("region", { name: "Inbox" }).getByRole("combobox", { name: "Nuevo chat" });
  const search = page.getByPlaceholder("Buscá un agente");
  // The picker loads after the first paint; until then its button opens nothing, so Enter goes again only then.
  await expect(async () => {
    if (!(await search.isVisible())) {
      await trigger.focus();
      await page.keyboard.press("Enter");
    }
    await expect(search).toBeFocused({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  // Its own sheet, not Config's: a bare browser input would show a border.
  await expect(search).toHaveCSS("border-top-width", "0px");

  await page.keyboard.type("zzz");
  await expect(search).toHaveValue("zzz");
  await expect(page.getByText("Sin resultados")).toBeVisible();
});
