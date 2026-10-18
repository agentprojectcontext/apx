import assert from "node:assert/strict";
import { test } from "node:test";
import { CdpPage, type CdpSend, withTimeout } from "./cdp.ts";

test("CDP deadlines reject stalled commands and preserve earlier results or failures", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = Promise.withResolvers<string>();
  const rejected = assert.rejects(withTimeout(stalled.promise, 50), {
    name: "ApxError",
    code: "timeout",
    message: "timed out after 50ms",
  });
  t.mock.timers.tick(50);
  await rejected;
  assert.equal(await withTimeout(Promise.resolve("Done"), 50), "Done");
  const error = new Error("CDP disconnected");
  await assert.rejects(withTimeout(Promise.reject(error), 50), (e) => e === error);
  t.mock.timers.tick(50);
});

/** A page answering layout metrics as given; records each captureScreenshot's parameters. */
function page(metrics: object | Error) {
  const shots: Array<Record<string, unknown>> = [];
  const send = (async (method: string, params?: object) => {
    if (method === "Page.getLayoutMetrics") {
      if (metrics instanceof Error) throw metrics;
      return metrics;
    }
    if (method === "Page.captureScreenshot") {
      shots.push({ ...params });
      return { data: "AAAA" };
    }
    throw new Error(`unexpected ${method}`);
  }) as CdpSend;
  return { cdp: new CdpPage(send, { selectAllModifiers: 0 }), shots };
}

const viewport = (width: number, height: number, dpr: number, pageY = 0) => ({
  cssVisualViewport: { pageX: 0, pageY, clientWidth: width, clientHeight: height },
  visualViewport: { pageX: 0, pageY, clientWidth: width * dpr, clientHeight: height * dpr },
});

test("a retina tab's picture is scaled down to 1280 pixels wide, of what the viewport shows", async () => {
  const { cdp, shots } = page(viewport(1440, 900, 2, 300));
  assert.equal(await cdp.screenshot(), "AAAA");
  const [shot] = shots;
  assert.equal(shot?.format, "jpeg");
  assert.equal(shot?.captureBeyondViewport, false);
  const clip = shot?.clip as { x: number; y: number; width: number; height: number; scale: number };
  assert.deepEqual({ ...clip, scale: undefined }, { x: 0, y: 300, width: 1440, height: 900, scale: undefined });
  assert.equal(Math.round(clip.width * clip.scale * 2), 1280);
});

test("a tab already narrower than the cap keeps its size", async () => {
  const { cdp, shots } = page(viewport(1024, 768, 1));
  await cdp.screenshot();
  assert.equal((shots[0]?.clip as { scale: number } | undefined)?.scale, 1);
});

test("a page that cannot tell its layout is captured as it is", async () => {
  const { cdp, shots } = page(new Error("not supported"));
  await cdp.screenshot();
  assert.equal(shots.length, 1);
  assert.equal(shots[0]?.clip, undefined);
});
