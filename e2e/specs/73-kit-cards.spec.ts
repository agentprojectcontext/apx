import type { Frame, Page } from "@playwright/test";
import { expect, open, rpc, test } from "./kit.ts";

/** A widget as agents write them: a page, a card with a plain heading and text, a flat card and a tile in a grid. */
const widget = `<script src="/_apx/kit@1.js"></script>
<main class="ax-page">
  <section class="ax-card" id="card"><h2>Sales by month</h2><p>Up 12% since March.</p></section>
  <section class="ax-card ax-card--flat" id="flat">Notes</section>
  <div class="ax-grid"><section class="ax-card" id="tile">7 orders</section></div>
</main>`;

const frames = (p: Page): Frame[] => p.frames().filter((f) => f.url().startsWith("about:srcdoc"));

test("a widget beside a chat takes the answer cards' look: no extra page padding, the card's padding, the line on its own cards", async ({
  page: p,
}) => {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" });
  const shown = await rpc<{ id: string }>("surfaces.show", {
    name: "kit-cards",
    title: "Sales",
    thread: chat.id,
    html: widget,
  });
  await open(p, `#thread=${chat.id}&panel=widget&widget=${shown.id}`);
  await expect.poll(() => frames(p).length).toBeGreaterThan(0);
  const f = frames(p)[0] as Frame;
  await expect(f.locator("#card")).toBeVisible();

  const look = await f.evaluate(() => {
    const css = (sel: string, pseudo?: string) => getComputedStyle(document.querySelector(sel) as Element, pseudo);
    return {
      embedded: document.documentElement.hasAttribute("data-ax-embed"),
      page: css(".ax-page").padding,
      // A narrow frame (the side panel, a phone) takes the narrow cards' padding, as answer cards do.
      card: css("#card").padding === (innerWidth <= 480 ? "14px 16px" : "16px 18px"),
      line: css("#card", "::before").height,
      flatLine: css("#flat", "::before").content,
      tileLine: css("#tile", "::before").content,
      tile: css("#tile").padding === css("#card").padding,
      heading: css("#card h2").marginTop,
      text: css("#card p").marginBottom,
    };
  });
  expect(look).toEqual({
    embedded: true,
    page: "0px",
    card: true,
    line: "3px",
    flatLine: "none",
    tileLine: "none",
    tile: true,
    heading: "0px",
    text: "0px",
  });
});
