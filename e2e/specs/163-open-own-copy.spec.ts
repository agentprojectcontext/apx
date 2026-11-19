// "Edit in APX" on a public page the owner published reaches the desktop app as an apx:// link: the panel opens the
// artifact it was published from instead of offering to install a copy. The desktop bridge and the cloud are stand-ins.
import type { Route } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

const CODE = "k3x9q2m7";
const ok = (result: unknown) => (route: Route) => route.fulfill({ json: { ok: true, result } });

test("an apx:// link to the owner's own public copy opens the original artifact", async ({ page }) => {
  const surface = await rpc<{ id: string }>("surfaces.show", {
    name: "own-copy-original",
    title: "Original aquarium",
    html: "<h1>Original aquarium</h1>",
  });
  try {
    await page.route(
      "**/rpc/account.get",
      ok({ available: true, profile: { id: "abcd2345", name: "Acme" }, pending: false, unreadable: false }),
    );
    await page.route(
      "**/rpc/surfaces.public_list",
      ok({
        items: [
          {
            code: CODE,
            surface: surface.id,
            url: `https://artifact.apxagent.app/${CODE}`,
            title: "Original aquarium",
            bytes: 900,
            updated_at: "2026-11-19T12:00:00.000Z",
          },
        ],
        count: 1,
        bytes: 900,
      }),
    );
    await page.addInitScript((code) => {
      let pending: string | null = code;
      Object.assign(window, {
        apxDesktop: {
          takePublicCopy: async () => {
            const value = pending;
            pending = null;
            return value;
          },
          onPublicCopy: () => () => {},
        },
      });
    }, CODE);
    await open(page);
    await expect(page).toHaveURL(new RegExp(`#app=${surface.id}`));
    await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "Original aquarium" })).toBeVisible();
  } finally {
    await rpc("surfaces.remove", { surface: surface.id });
  }
});
