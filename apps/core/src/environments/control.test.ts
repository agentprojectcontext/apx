import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { computerControl } from "./control.ts";

test("takeover fences delayed CDP writes permanently for that lease, even after returning control", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  try {
    const control = computerControl();
    let resume: () => void = () => {};
    const pause = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const late = control.run("agent", async () => {
      control.checkCdp("Input.dispatchMouseEvent");
      await pause;
      control.checkCdp("DOM.focus");
    });
    const rejected = assert.rejects(late, /manual control|return control/);
    await control.change("human", async () => {});
    assert.equal(control.human(), true);
    control.checkCdp("Fetch.continueRequest");
    assert.throws(() => control.assert("agent"), /manual control/);
    await control.change("agent", async () => {});
    resume();
    await rejected;
    await control.run("agent", async () => control.checkCdp("Page.navigate"));
    assert.equal(control.human(), false);
    await assert.rejects(
      control.change("human", async () => {
        throw new Error("guest cancellation failed");
      }),
      /cancellation failed/,
    );
    assert.equal(control.human(), false);
    assert.throws(() => control.assert("agent"));
    await control.change("human", async () => {});
    assert.equal(control.human(), true);
    // A restart starts every screen in its agent's hands.
    assert.equal(computerControl().human(), false);
    control.reset();
    assert.equal(control.human(), false, "a screen that stops gives it back");
  } finally {
    await env.core.close();
    env.cleanup();
  }
});
