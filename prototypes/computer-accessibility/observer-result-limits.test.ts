import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ObserverResults } from "./observer-results.ts";
import type { ObserverCommand } from "./owned-observer.ts";

const command: ObserverCommand = { op: "listWindows", pid: 42, launchIdentity: { seconds: 100, microseconds: 0 } };
function setup() {
  const results = new ObserverResults();
  const session = randomUUID();
  const generation = randomUUID();
  const handle = `${session}:${generation}:${randomUUID()}`;
  results.validate(command, {
    version: 1,
    generation,
    listing: {
      session,
      generation,
      pid: 42,
      launchIdentity: command.launchIdentity,
      windows: [{ handle, title: "Acme", ambiguous: false }],
    },
  });
  const next = randomUUID();
  let count = 0;
  const node = () => ({
    ref: `${session}:${next}:${count++}`,
    role: "AXGroup",
    redacted: false,
    children: [] as unknown[],
  });
  const root = node();
  root.role = "AXWindow";
  const response = {
    version: 1,
    generation: next,
    selectedObservation: {
      session,
      generation: next,
      pid: 42,
      launchIdentity: command.launchIdentity,
      handle,
      association: "ax-only-no-capture-or-coordinates",
      nodes: [root],
    },
  };
  const selected: ObserverCommand = { ...command, op: "observeSelected", handle };
  return { results, response, root, node, selected };
}
for (const total of [256, 257]) {
  test(`node count ${total} ${total === 256 ? "is admitted" : "is refused"}`, () => {
    const f = setup();
    for (let index = 1; index < total; index++) f.root.children.push(f.node());
    if (total === 256) assert.equal(f.results.validate(f.selected, f.response).kind, "observation");
    else assert.throws(() => f.results.validate(f.selected, f.response), /^Error: OBSERVER_INVALID_RESULT$/);
  });
}
for (const depth of [16, 17]) {
  test(`tree depth ${depth} ${depth === 16 ? "is admitted" : "is refused"}`, () => {
    const f = setup();
    let current = f.root;
    for (let index = 0; index < depth; index++) {
      const child = f.node();
      current.children.push(child);
      current = child;
    }
    if (depth === 16) assert.equal(f.results.validate(f.selected, f.response).kind, "observation");
    else assert.throws(() => f.results.validate(f.selected, f.response), /^Error: OBSERVER_INVALID_RESULT$/);
  });
}

test("a historical generation cannot be reused after an intervening response", () => {
  const results = new ObserverResults();
  const first = { version: 1, generation: randomUUID(), error: "UNAVAILABLE" };
  assert.equal(results.validate(command, first).kind, "error");
  assert.equal(results.validate(command, { ...first, generation: randomUUID() }).kind, "error");
  assert.throws(() => results.validate(command, first), /OBSERVER_INVALID_RESULT/);
});

test("the generation budget refuses further commands locally without unbounded history", () => {
  const results = new ObserverResults();
  for (let index = 0; index < 4096; index++)
    assert.equal(
      results.validate(command, { version: 1, generation: randomUUID(), error: "UNAVAILABLE" }).kind,
      "error",
    );
  assert.throws(() => results.prepare(command), /OBSERVER_INVALID_RESULT/);
});

for (const value of [null, [], 1, { version: 1 }, { version: 1, generation: randomUUID(), error: null }]) {
  test(`non-result shape ${JSON.stringify(value)} is refused`, () => {
    assert.throws(() => new ObserverResults().validate(command, value), /^Error: OBSERVER_INVALID_RESULT$/);
  });
}

for (const launchIdentity of [
  { seconds: 0, microseconds: 0 },
  { seconds: 100, microseconds: -1 },
  { seconds: 100, microseconds: 1_000_000 },
  { seconds: Number.NaN, microseconds: 0 },
]) {
  test(`invalid input identity ${JSON.stringify(launchIdentity)} is refused before transport`, () => {
    assert.throws(() => new ObserverResults().prepare({ ...command, launchIdentity }), /OBSERVER_INVALID_RESULT/);
  });
}
