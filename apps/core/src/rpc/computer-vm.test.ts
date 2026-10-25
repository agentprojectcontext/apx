import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { computerHandlers } from "./computer.ts";

test("in a chat on the Linux computer, the owner's Mac screen is never looked at or acted on", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const asked: string[] = [];
  const broker = {
    onEvent: () => () => {},
    invoke: async (_cap: string, method: string) => {
      asked.push(method);
      return { mime: "image/jpeg", data: "", app: "Finder" };
    },
  } as unknown as NodeBroker;
  try {
    const h = computerHandlers(broker, env.core.store, env.home, { cancel: () => 0 }, (t) => t === "thr_vm");
    const agent = (thread: string) => ({ agent: { id: "roby", run_id: "run_1", thread_id: thread } }) as never;
    await assert.rejects(
      h["computer.snapshot"]({ thread: "thr_vm" } as never, agent("thr_vm")),
      /this chat works on your Linux computer now: the screen tools see and act on the owner's Mac/,
    );
    await assert.rejects(h["computer.click"]({ x: 1, y: 1 } as never, agent("thr_vm")), /Linux computer/);
    assert.deepEqual(asked, [], "the desktop was never asked");
    // A chat on the Mac still reaches it.
    await h["computer.snapshot"]({ thread: "thr_mac" } as never, agent("thr_mac")).catch(() => {});
    assert.deepEqual(asked, ["computer.snapshot"]);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
