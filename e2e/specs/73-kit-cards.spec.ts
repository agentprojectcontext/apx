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

const donut = (legend = "") => `<script src="/_apx/kit@1.js"></script>
<main class="ax-page"><section class="ax-card"><h2>Spending in May</h2>
<ax-donut label="$900" sub="total"${legend} data='[{"label":"Rent","value":500,"tone":"brand"},{"label":"Food","value":250,"tone":"info"},{"label":"Transport","value":100,"tone":"violet"},{"label":"Other","value":50,"tone":"warning"}]'></ax-donut>
</section></main>`;

let shownDonuts = 0;
async function showDonut(p: Page, html: string): Promise<Frame> {
  await rpc("setup.finish", {});
  const chat = await rpc<{ id: string }>("threads.create", { kind: "agent", agent_id: "superagent" });
  const shown = await rpc<{ id: string }>("surfaces.show", {
    name: `kit-donut-${++shownDonuts}`,
    title: "Spending",
    thread: chat.id,
    html,
  });
  await open(p, `#thread=${chat.id}&panel=widget&widget=${shown.id}`);
  await expect.poll(() => frames(p).length).toBeGreaterThan(0);
  const f = frames(p)[0] as Frame;
  await expect(f.locator("ax-donut svg")).toBeVisible();
  return f;
}

for (const width of [1280, 390])
  test(`a donut names its slices beside it, in their colors, at ${width}px`, async ({ page: p }) => {
    await p.setViewportSize({ width, height: 844 });
    const f = await showDonut(p, donut());
    const legend = f.locator(".ax-donut__legend");
    await expect(legend).toBeVisible();
    const read = await f.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const arcs = [...document.querySelectorAll("ax-donut svg circle")].slice(1).map((c) => c.getAttribute("stroke"));
      const swatches = [...document.querySelectorAll(".ax-donut__legend i")].map(
        (i) => (i as HTMLElement).style.background,
      );
      const card = box(document.querySelector(".ax-card") as Element);
      const leg = box(document.querySelector(".ax-donut__legend") as Element);
      return {
        rows: [...document.querySelectorAll(".ax-donut__legend span")].map((s) => {
          const value = s.nextElementSibling as Element;
          return `${s.textContent} ${value.textContent} ${value.nextElementSibling?.textContent}`;
        }),
        sameColors: arcs.length === 4 && arcs.every((c, i) => c === swatches[i]),
        inside: leg.left >= card.left && leg.right <= card.right,
        noScroll: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(read).toEqual({
      rows: ["Rent 500 56%", "Food 250 28%", "Transport 100 11%", "Other 50 6%"],
      sameColors: true,
      inside: true,
      noScroll: true,
    });
  });

test('a donut whose card already lists its slices drops its legend with legend="none"', async ({ page: p }) => {
  const f = await showDonut(p, donut(' legend="none"'));
  await expect(f.locator(".ax-ring__c b")).toHaveText("$900");
  await expect(f.locator(".ax-donut__legend")).toHaveCount(0);
});

test("a widget's page comes over the live socket, not queued behind the panel's HTTP calls", async ({ page: p }) => {
  const overHttp: string[] = [];
  const overSocket: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/rpc/surfaces.get")) overHttp.push(r.url());
  });
  p.on("websocket", (ws) =>
    ws.on("framesent", (frame) => {
      if (String(frame.payload).includes('"method":"surfaces.get"')) overSocket.push(String(frame.payload));
    }),
  );
  await showDonut(p, donut());
  expect(overSocket.length).toBeGreaterThan(0);
  expect(overHttp).toEqual([]);
});
