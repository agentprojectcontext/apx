// A call for the owner's Chrome while its extension is not connected: a reconnect is waited for, a closed Chrome is
// started, and only then is the agent told what the owner has to do.
import assert from "node:assert/strict";
import test from "node:test";
import { createNodeBroker } from "../nodes/broker.ts";
import type { ChromeOpen } from "../nodes/chrome-launch.ts";
import { browserHandlers, type OwnersChrome } from "./browser.ts";

const owner = { transport: "internal", role: "operator", actor: "human", session: undefined } as never;

function setup(open: (connect: () => void) => Promise<ChromeOpen>, waits: Partial<OwnersChrome> = {}) {
  const broker = createNodeBroker();
  let opens = 0;
  const connect = () =>
    broker.attach({
      session: "chrome-1",
      name: "apx-chrome",
      caps: ["chrome"],
      send(frame) {
        const { id, params } = frame as { id: string; params: { url?: string } };
        queueMicrotask(() =>
          broker.settle(id, { ok: true, result: { tab: "c7", url: params.url ?? "", title: "Northwind orders" } }),
        );
      },
    });
  const chrome: OwnersChrome = {
    open: () => {
      opens++;
      return open(connect);
    },
    graceMs: 0,
    startMs: 0,
    ...waits,
  };
  const handlers = browserHandlers(broker, undefined, undefined, undefined, undefined, undefined, chrome);
  const openTab = () =>
    handlers["browser.open"]({ url: "https://northwind.example/orders", chrome: true } as never, owner) as Promise<{
      tab: string;
    }>;
  return { handlers, connect, openTab, opens: () => opens };
}

test("an extension reconnecting a moment later is waited for, and Chrome is not started", async () => {
  const s = setup(async () => "opened", { graceMs: 60_000 });
  const pending = s.openTab();
  s.connect();
  assert.equal((await pending).tab, "c7");
  assert.equal(s.opens(), 0);
});

test("with Chrome closed, opening a tab starts it and goes on once its extension connects", async () => {
  const s = setup(
    async (connect) => {
      setImmediate(connect);
      return "opened";
    },
    { startMs: 60_000 },
  );
  assert.equal((await s.openTab()).tab, "c7");
  assert.equal(s.opens(), 1);
});

test("what the agent is told when Chrome still cannot be reached", async () => {
  await assert.rejects(setup(async () => "no_extension").openTab(), /extension is not installed/);
  await assert.rejects(setup(async () => "failed").openTab(), /Chrome is closed and APX could not open it/);
  await assert.rejects(
    setup(async () => {
      throw new Error("spawn failed");
    }).openTab(),
    /could not open it/,
  );
  await assert.rejects(setup(async () => "opened").openTab(), /did not connect: ask them to check it is turned on/);
});

test("only opening a tab starts Chrome: a call on one of its tabs says it is not connected", async () => {
  const s = setup(async () => "opened");
  await assert.rejects(
    async () => s.handlers["browser.text"]({ tab: "c7" } as never, owner),
    /Chrome is not connected/,
  );
  assert.equal(s.opens(), 0);
});
