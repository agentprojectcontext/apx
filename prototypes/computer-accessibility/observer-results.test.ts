import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ObserverResults } from "./observer-results.ts";
import type { ObserverCommand } from "./owned-observer.ts";

const pid = 42;
const launchIdentity = { seconds: 100, microseconds: 20 };
const list: ObserverCommand = { op: "listWindows", pid, launchIdentity };
function fixture() {
  const session = randomUUID();
  const generation = randomUUID();
  const handle = `${session}:${generation}:${randomUUID()}`;
  const listing = {
    version: 1,
    generation,
    listing: {
      session,
      generation,
      pid,
      launchIdentity: { ...launchIdentity },
      windows: [{ handle, title: "Acme", ambiguous: false }],
    },
  };
  const observedGeneration = randomUUID();
  const observation = {
    version: 1,
    generation: observedGeneration,
    selectedObservation: {
      session,
      generation: observedGeneration,
      pid,
      launchIdentity: { ...launchIdentity },
      handle,
      association: "ax-only-no-capture-or-coordinates",
      nodes: [
        {
          ref: `${session}:${observedGeneration}:0`,
          role: "AXWindow",
          redacted: false,
          children: [
            {
              ref: `${session}:${observedGeneration}:1`,
              role: "AXButton",
              title: "Next",
              redacted: false,
              children: [],
            },
            { ref: `${session}:${observedGeneration}:2`, role: "AXSecureTextField", redacted: true, children: [] },
          ],
        },
      ],
    },
  };
  const command: ObserverCommand = { op: "observeSelected", pid, launchIdentity, handle };
  return { listing, observation, command, handle, session };
}
test("a retained window is read only under its matching identity and session", () => {
  const f = fixture();
  const results = new ObserverResults();
  const listed = results.validate(list, f.listing);
  assert.equal(listed.kind, "listing");
  const observed = results.validate(f.command, f.observation);
  assert.equal(observed.kind, "observation");
  if (observed.kind !== "observation") throw new Error("Expected observation");
  assert.equal(observed.handle, f.handle);
  assert.equal(observed.nodes[0]?.children[1]?.redacted, true);
  f.observation.selectedObservation.nodes[0]?.children.splice(0);
  assert.equal(observed.nodes[0]?.children.length, 2, "validated output owns its tree");
});

test("ambiguous, unnamed and empty window listings remain explicit", () => {
  const f = fixture();
  const results = new ObserverResults();
  f.listing.listing.windows.push({
    handle: `${f.session}:${f.listing.generation}:${randomUUID()}`,
    title: "Acme",
    ambiguous: true,
  });
  const first = f.listing.listing.windows[0];
  assert.ok(first);
  first.ambiguous = true;
  assert.equal(results.validate(list, f.listing).kind, "listing");
  const empty = fixture();
  empty.listing.listing.windows = [];
  assert.equal(new ObserverResults().validate(list, empty.listing).kind, "listing");
  const unnamed = fixture();
  Reflect.deleteProperty(unnamed.listing.listing.windows[0] ?? {}, "title");
  const window = unnamed.listing.listing.windows[0];
  assert.ok(window);
  window.ambiguous = true;
  assert.equal(new ObserverResults().validate(list, unnamed.listing).kind, "listing");
});

const listingMutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
  "wrong process": (f) => {
    f.listing.listing.pid++;
  },
  "reused process launch": (f) => {
    f.listing.listing.launchIdentity.microseconds++;
  },
  "missing generation": (f) => {
    Reflect.deleteProperty(f.listing, "generation");
  },
  "mismatched generation": (f) => {
    f.listing.listing.generation = randomUUID();
  },
  "foreign handle namespace": (f) => {
    Object.assign(f.listing.listing.windows[0] ?? {}, { handle: randomUUID() });
  },
  "duplicate handle": (f) => {
    const window = f.listing.listing.windows[0];
    assert.ok(window);
    f.listing.listing.windows.push(window);
  },
  "unmarked ambiguity": (f) => {
    const window = f.listing.listing.windows[0];
    assert.ok(window);
    f.listing.listing.windows.push({ ...window, handle: `${f.session}:${f.listing.generation}:${randomUUID()}` });
  },
  "oversize title": (f) => {
    Object.assign(f.listing.listing.windows[0] ?? {}, { title: "é".repeat(65) });
  },
  "control in title": (f) => {
    Object.assign(f.listing.listing.windows[0] ?? {}, { title: "Acme\nPrivate" });
  },
  "unexpected secret field": (f) => {
    Object.assign(f.listing.listing, { value: "PRIVATE_MARKER" });
  },
  "mixed error and listing": (f) => {
    Object.assign(f.listing, { error: "UNAVAILABLE" });
  },
  "too many windows": (f) => {
    f.listing.listing.windows = Array.from({ length: 65 }, () => ({
      handle: `${f.session}:${f.listing.generation}:${randomUUID()}`,
      title: "Acme",
      ambiguous: true,
    }));
  },
};
for (const [name, mutate] of Object.entries(listingMutations)) {
  test(`listing refuses ${name} and permanently retires validation`, () => {
    const f = fixture();
    const results = new ObserverResults();
    mutate(f);
    assert.throws(() => results.validate(list, f.listing), /^Error: OBSERVER_INVALID_RESULT$/);
    assert.throws(() => results.validate(list, fixture().listing), /OBSERVER_INVALID_RESULT/);
  });
}

const observationMutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
  "foreign process": (f) => {
    f.observation.selectedObservation.pid++;
  },
  "foreign session": (f) => {
    f.observation.selectedObservation.session = randomUUID();
  },
  "wrong retained window": (f) => {
    f.observation.selectedObservation.handle = randomUUID();
  },
  "capture association": (f) => {
    f.observation.selectedObservation.association = "capture";
  },
  "foreign reference": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0] ?? {}, { ref: randomUUID() });
  },
  "duplicate reference": (f) => {
    const root = f.observation.selectedObservation.nodes[0];
    assert.ok(root);
    Object.assign(root.children[0] ?? {}, { ref: root.ref });
  },
  "excluded web role": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0]?.children[0] ?? {}, { role: "AXWebArea" });
  },
  "unredacted secure field": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0]?.children[1] ?? {}, { redacted: false });
  },
  "redacted title": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0]?.children[1] ?? {}, { title: "PRIVATE_MARKER" });
  },
  "redacted children": (f) => {
    const root = f.observation.selectedObservation.nodes[0];
    assert.ok(root);
    Object.assign(root.children[1] ?? {}, { children: [root.children[0]] });
  },
  "unknown value": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0] ?? {}, { value: "PRIVATE_MARKER" });
  },
  "window title": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0] ?? {}, { title: "Private" });
  },
  "non-window root": (f) => {
    Object.assign(f.observation.selectedObservation.nodes[0] ?? {}, { role: "AXButton" });
  },
  "multiple roots": (f) => {
    const root = f.observation.selectedObservation.nodes[0];
    assert.ok(root);
    f.observation.selectedObservation.nodes.push(root);
  },
};
for (const [name, mutate] of Object.entries(observationMutations)) {
  test(`observation refuses ${name}`, () => {
    const f = fixture();
    const results = new ObserverResults();
    results.validate(list, f.listing);
    mutate(f);
    assert.throws(() => results.validate(f.command, f.observation), /^Error: OBSERVER_INVALID_RESULT$/);
  });
}

test("errors expose only fixed codes and retire retained selection", () => {
  const f = fixture();
  const results = new ObserverResults();
  results.validate(list, f.listing);
  assert.deepEqual(results.validate(f.command, { version: 1, generation: randomUUID(), error: "WINDOW_UNRESOLVED" }), {
    kind: "error",
    code: "WINDOW_UNRESOLVED",
  });
  assert.throws(() => results.validate(f.command, f.observation), /OBSERVER_INVALID_RESULT/);
  assert.throws(
    () => new ObserverResults().validate(list, { version: 1, generation: randomUUID(), error: "PRIVATE_MARKER" }),
    /^Error: OBSERVER_INVALID_RESULT$/,
  );
});

test("new listings replace selection, process identity and old handles", () => {
  const f = fixture();
  const results = new ObserverResults();
  results.validate(list, f.listing);
  const next = fixture();
  next.listing.listing.session = f.session;
  next.listing.listing.windows = [];
  results.validate(list, next.listing);
  assert.throws(() => results.validate(f.command, f.observation), /OBSERVER_INVALID_RESULT/);
});

test("repeated generations and reads before listing fail closed", () => {
  const f = fixture();
  assert.throws(() => new ObserverResults().validate(f.command, f.observation), /OBSERVER_INVALID_RESULT/);
  const results = new ObserverResults();
  results.validate(list, f.listing);
  assert.throws(() => results.validate(list, f.listing), /OBSERVER_INVALID_RESULT/);
});

test("input identity must be valid even when reflected by an untrusted helper", () => {
  const f = fixture();
  const invalid = { ...list, pid: 0 };
  f.listing.listing.pid = 0;
  assert.throws(() => new ObserverResults().validate(invalid, f.listing), /OBSERVER_INVALID_RESULT/);
});
