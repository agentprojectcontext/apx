// A widget shows its project's own media by reference: the reel plays behind the takes, the cover and a stored image
// show (what is refused, and why, is apps/core/src/rpc/surface-media.test.ts).
import fs from "node:fs";
import path from "node:path";
import { expect, open, rpc, test } from "./kit.ts";

const fixtures = path.resolve(import.meta.dirname, "../fixtures/media");

test("a widget plays its project's MP4 behind it and shows the project's images", async ({ page }) => {
  const projects = (await rpc<{ projects: Array<{ id: string; name: string; path?: string }> }>("projects.list"))
    .projects;
  const northwind = projects.find((p) => p.name === "Northwind");
  if (!northwind?.path) throw new Error("Northwind has no folder");
  const reels = path.join(northwind.path, "reels");
  fs.mkdirSync(reels, { recursive: true });
  fs.copyFileSync(path.join(fixtures, "preview.mp4"), path.join(reels, "take-1.mp4"));
  fs.copyFileSync(path.join(fixtures, "preview.jpg"), path.join(reels, "cover.jpg"));
  const chat = await rpc<{ id: string }>("threads.create", {
    kind: "agent",
    agent_id: "roby",
    project_id: northwind.id,
  });
  const stored = await rpc<{ media: { id: string } }>("media.upload", {
    name: "frame.jpg",
    mime: "image/jpeg",
    data: fs.readFileSync(path.join(fixtures, "preview.jpg")).toString("base64"),
    thread: chat.id,
  });
  await rpc("surfaces.show", {
    name: "reel-takes",
    title: "Tomas del reel",
    pinned: true,
    thread: chat.id,
    html: `<div style="position:relative;height:220px">
  <video data-apx-src="reels/take-1.mp4" autoplay muted loop playsinline
    style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
  <p style="position:relative">Toma 1: gancho en el primer segundo</p>
</div>
<img alt="Portada" data-apx-src="reels/cover.jpg">
<img alt="Cuadro" data-apx-src="media:${stored.media.id}">`,
  });

  await open(page);
  await page.getByRole("button", { name: /^Northwind/ }).click();
  const tile = page.getByRole("region", { name: "Tablero" }).getByRole("article", { name: "Tomas del reel" });
  const frame = tile.frameLocator("iframe");
  await expect(frame.getByText("Toma 1: gancho en el primer segundo")).toBeVisible();

  // The video plays from a blob: URL of the widget's own, behind the text.
  const video = frame.locator("video");
  await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).src)).toMatch(/^blob:/);
  await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  for (const alt of ["Portada", "Cuadro"]) {
    const img = frame.getByRole("img", { name: alt });
    await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(320);
  }

  await tile.getByRole("button", { name: /^Quitar del tablero/ }).click();
  fs.rmSync(reels, { recursive: true, force: true });
});
