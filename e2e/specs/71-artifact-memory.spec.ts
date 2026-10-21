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

test("an artifact's store and database survive a reload, and only a live one keeps running out of sight", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  const live = await rpc<{ id: string }>("surfaces.show", {
    name: "memory-live",
    title: "Live",
    html: page(true),
    app: true,
  });
  const plain = await rpc<{ id: string }>("surfaces.show", {
    name: "memory-plain",
    title: "Plain",
    html: page(false),
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

  // Out of sight, the live page keeps its document; the plain one is closed and starts again on return.
  const marked = (id: string) =>
    Promise.all(frames(p).map((f) => f.evaluate((m) => (window as unknown as { mark?: string }).mark === m, id))).then(
      (all) => all.filter(Boolean).length,
    );
  for (const [id, kept] of [
    [live.id, 1],
    [plain.id, 0],
  ] as const) {
    await open(p, `#app=${id}`);
    await expect.poll(() => frames(p).length).toBeGreaterThan(0);
    // The page shown now is the one whose frame has no mark yet.
    for (const f of frames(p))
      await f.evaluate((m) => {
        const w = window as unknown as { mark?: string };
        w.mark ??= m;
      }, id);
    await p.evaluate(() => {
      location.hash = "";
    });
    await expect.poll(() => marked(id)).toBe(kept);
    await p.evaluate((i) => {
      location.hash = `app=${i}`;
    }, id);
    await expect.poll(() => frames(p).length).toBeGreaterThan(0);
    await expect.poll(() => marked(id)).toBe(kept);
  }
});
