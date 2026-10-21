import type { Frame, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** A kit page that keeps a reading in its store and a row per click in its database. */
const page = (live: boolean) => `${live ? '<meta name="apx-live" content="on">' : ""}
<script src="/_apx/kit@1.js"></script>
<main class="ax-page"><button id="save" class="ax-btn">Save</button><output id="out">loading</output></main>
<script>
const out = document.getElementById("out");
async function show() {
  const reading = await APX.store.get("reading");
  const rows = await APX.db.query("SELECT n FROM marks ORDER BY n");
  out.textContent = (reading ?? "none") + "|" + rows.map((r) => r.n).join(",");
}
APX.db.exec("CREATE TABLE IF NOT EXISTS marks (n INTEGER)").then(show);
document.getElementById("save").onclick = async () => {
  await APX.store.set("reading", "r1");
  await APX.db.exec("INSERT INTO marks (n) VALUES (?)", [7]);
  show();
};
</script>`;

const frames = (p: Page): Frame[] => p.frames().filter((f) => f.url().startsWith("about:srcdoc"));

test("an artifact's store and database survive a reload", async ({ page: p }) => {
  await rpc("setup.finish", {});
  const live = await rpc<{ id: string }>("surfaces.show", {
    name: "memory-live",
    title: "Live",
    html: page(true),
    app: true,
  });

  await open(p, `#app=${live.id}`);
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("none|");
  await frames(p)[0]?.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("r1|7");
  await p.reload();
  await expect.poll(() => frames(p)[0]?.evaluate(() => document.getElementById("out")?.textContent)).toBe("r1|7");
  const memory = await rpc<{ store: { keys: string[] }; db: { tables: { name: string; rows: number }[] } }>(
    "surfaces.memory",
    { surface: live.id },
  );
  expect(memory.store.keys).toEqual(["reading"]);
  expect(memory.db.tables).toContainEqual({ name: "marks", rows: 1 });
});

test("an opened app keeps running as it was left while the owner goes elsewhere, until it is closed", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  const one = await rpc<{ id: string }>("surfaces.show", {
    name: "dock-one",
    title: "Dock one",
    html: page(false),
    app: true,
  });
  const two = await rpc<{ id: string }>("surfaces.show", {
    name: "dock-two",
    title: "Dock two",
    html: page(false),
    app: true,
  });
  const marked = () =>
    Promise.all(frames(p).map((f) => f.evaluate(() => (window as unknown as { mark?: string }).mark === "left"))).then(
      (all) => all.filter(Boolean).length,
    );

  await open(p, `#app=${one.id}`);
  await expect.poll(() => frames(p).length).toBe(1);
  await frames(p)[0]?.evaluate(() => {
    (window as unknown as { mark: string }).mark = "left";
  });
  // Another app, then the inbox: the first one is still the same page when the owner comes back.
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, two.id);
  await expect.poll(() => frames(p).length).toBe(2);
  await p.evaluate(() => {
    location.hash = "";
  });
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, one.id);
  await expect.poll(marked).toBe(1);
  await expect(p.locator(".navitem__running")).toHaveCount(2);

  // Closed, it is gone: opened again, it starts over from its memory.
  await p.locator(".appscreen__head").getByRole("button", { name: "Cerrar app" }).click();
  await expect(p.locator(".navitem__running")).toHaveCount(1);
  await p.evaluate((i) => {
    location.hash = `app=${i}`;
  }, one.id);
  await expect.poll(() => frames(p).length).toBe(2);
  await expect.poll(marked).toBe(0);
});
