import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_VERSION } from "@apx/protocol";
import {
  createUpdateCoordinator,
  type PendingUpdate,
  type UpdateEndpoint,
  type UpdateState,
} from "./update-coordinator.ts";

function harness(saved?: PendingUpdate, current = "2.0.0") {
  let pending = saved;
  let time = 0;
  let stages = 0;
  let activations = 0;
  let applies = 0;
  const errors: string[] = [];
  let state: UpdateState = { running: "2.0.0", coordination: null, coordination_protocol: 1, supported: true };
  const endpoint: UpdateEndpoint = {
    identity: "https://apx.example.com",
    local: false,
    health: async () => ({ home_id: "installation-a", protocol: PROTOCOL_VERSION }),
    state: async () => state,
    prepare: async (target) => ({ target, phase: "prepared", running: state.running }),
    apply: async (target) => {
      applies++;
      state = { ...state, running: target, coordination: { target, phase: "complete", running: target } };
      return { ok: true, log: "" };
    },
  };
  const coordinator = createUpdateCoordinator({
    current,
    load: () => pending,
    save: (p) => {
      pending = p;
    },
    stage: async () => {
      stages++;
      return { ok: true, ready: true };
    },
    activate: () => {
      activations++;
    },
    sleep: async () => {
      time += 1000;
    },
    now: () => time,
    timeoutMs: 3000,
    failed: (error) => errors.push(error),
  });
  coordinator.connect(endpoint);
  return {
    coordinator,
    endpoint,
    errors,
    pending: () => pending,
    stages: () => stages,
    activations: () => activations,
    applies: () => applies,
    state: () => state,
    setState: (next: UpdateState) => {
      state = next;
    },
  };
}

test("concurrent native entry points share one pinned preparation and remote update", async () => {
  const h = harness();
  const first = h.coordinator.install("2.1.0");
  assert.equal(h.coordinator.install("2.2.0"), first);
  assert.deepEqual(await first, { ok: true, ready: true });
  assert.equal(h.applies(), 1);
  assert.equal(h.stages(), 1);
  assert.equal(h.pending()?.target, "2.1.0");
  assert.equal(h.coordinator.canApplyOnQuit(), false);
  await h.coordinator.restart();
  assert.equal(h.activations(), 1);
});

test("server failure prevents activation including restart and quit", async () => {
  const h = harness();
  h.endpoint.apply = async () => ({ ok: false, log: "Server install failed" });
  const result = await h.coordinator.install("2.1.0");
  assert.equal(result.ok, false);
  await h.coordinator.restart();
  assert.equal(h.activations(), 0);
  assert.equal(h.coordinator.canApplyOnQuit(), false);
  assert.equal(h.pending()?.target, "2.1.0");
});

test("a lost apply response succeeds only after exact running version confirmation", async () => {
  const h = harness();
  h.endpoint.apply = async () => {
    h.setState({
      running: "2.1.0",
      coordination: { target: "2.1.0", phase: "complete", running: "2.1.0" },
      coordination_protocol: 1,
      supported: true,
    });
    throw new Error("Connection reset");
  };
  assert.equal((await h.coordinator.install("2.1.0")).ok, true);
  const wrong = harness();
  wrong.endpoint.apply = async () => ({ ok: true, log: "" });
  wrong.setState({ running: "2.0.9", coordination: null, coordination_protocol: 1, supported: true });
  assert.equal((await wrong.coordinator.install("2.1.0")).ok, false);
  assert.match(wrong.errors[0] ?? "", /not confirmed/);
  assert.equal(wrong.activations(), 0);
});

test("persisted interrupted target wins over a newer feed after process restart", async () => {
  const h = harness({ identity: "https://apx.example.com", home: "installation-a", target: "2.1.0" });
  assert.equal((await h.coordinator.install("2.2.0")).ok, true);
  assert.equal(h.state().running, "2.1.0");
});

test("a completed release does not pin an up-to-date app to the previous target", async () => {
  for (const saved of [undefined, { identity: "https://apx.example.com", home: "installation-a", target: "2.1.0" }]) {
    const h = harness(saved, "2.1.0");
    h.setState({
      ...h.state(),
      running: "2.1.0",
      coordination: { target: "2.1.0", phase: "complete", running: "2.1.0" },
    });
    assert.equal((await h.coordinator.install("2.2.0")).ok, true);
    assert.equal(h.state().running, "2.2.0");
    assert.equal(h.pending()?.target, "2.2.0");
    assert.equal(h.applies(), 1);
  }
});

test("a returning offline app catches up to the completed release before a newer feed", async () => {
  const h = harness();
  h.setState({
    ...h.state(),
    running: "2.1.0",
    coordination: { target: "2.1.0", phase: "complete", running: "2.1.0" },
  });
  assert.equal((await h.coordinator.install("2.2.0")).ok, true);
  assert.equal(h.pending()?.target, "2.1.0");
  assert.equal(h.applies(), 0);
});

test("corrupt server intent surfaces its recovery error without downloading", async () => {
  const h = harness();
  h.setState({
    ...h.state(),
    supported: false,
    error: "Stored update intent is invalid. Repair the server update state.",
  });
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.stages(), 0);
  assert.match(h.errors[0] ?? "", /Stored update intent/);
});

test("a reconnect cannot reuse a persisted target against a replacement server", async () => {
  const h = harness({ identity: "https://apx.example.com", home: "previous-installation", target: "2.1.0" });
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.stages(), 0);
  assert.equal(h.applies(), 0);
  assert.match(h.errors[0] ?? "", /identity differs/);
});

test("a missing update coordination protocol cannot authorize a download", async () => {
  const h = harness();
  const state = h.state();
  Reflect.deleteProperty(state, "coordination_protocol");
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.stages(), 0);
  assert.match(h.errors[0] ?? "", /incompatible update protocol/);
});

test("offline client reconciles server target on returning without forced restart", async () => {
  const h = harness();
  h.setState({
    running: "2.1.0",
    coordination: { target: "2.1.0", phase: "complete", running: "2.1.0" },
    coordination_protocol: 1,
    supported: true,
  });
  await h.coordinator.reconcile();
  assert.equal(h.stages(), 1);
  assert.equal(h.applies(), 0);
  assert.equal(h.activations(), 0);
});

test("legacy and incompatible protocols block safe native application", async () => {
  for (const error of ["Unknown method system.update_state", "Protocol mismatch", "Unauthorized"]) {
    const h = harness();
    h.endpoint.state = async () => {
      throw new Error(error);
    };
    assert.equal((await h.coordinator.install("2.1.0")).ok, false);
    assert.equal(h.stages(), 0);
    assert.equal(h.activations(), 0);
    assert.equal(h.errors[0], error);
  }
});

test("the authenticated update lane can finish across a main protocol change", async () => {
  for (const initiallyIncompatible of [false, true]) {
    const h = harness();
    h.endpoint.health = async () => ({
      home_id: "installation-a",
      protocol: initiallyIncompatible || h.state().running === "2.1.0" ? PROTOCOL_VERSION + 1 : PROTOCOL_VERSION,
    });
    assert.equal((await h.coordinator.install("2.1.0")).ok, true);
    assert.equal(h.applies(), 1);
    await h.coordinator.restart();
    assert.equal(h.activations(), 1);
  }
});

test("a main protocol mismatch cannot bypass unsupported or unknown update lanes", async () => {
  for (const unsupported of [true, false]) {
    const h = harness();
    h.endpoint.health = async () => ({ home_id: "installation-a", protocol: PROTOCOL_VERSION + 1 });
    if (unsupported) h.setState({ ...h.state(), supported: false });
    else Reflect.set(h.state(), "coordination_protocol", 2);
    assert.equal((await h.coordinator.install("2.1.0")).ok, false);
    assert.equal(h.stages(), 0);
    assert.equal(h.applies(), 0);
  }
});

test("losing update lane support after the server restart blocks Desktop activation", async () => {
  const h = harness();
  const apply = h.endpoint.apply;
  h.endpoint.apply = async (target) => {
    const result = await apply(target);
    h.setState({ ...h.state(), supported: false });
    return result;
  };
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.activations(), 0);
});

test("changing connection during a download revokes activation", async () => {
  const h = harness();
  h.endpoint.prepare = async (target) => {
    h.coordinator.connect({ ...h.endpoint, identity: "https://other.example.com" });
    return { target, running: "2.0.0", phase: "prepared" };
  };
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.stages(), 0);
  assert.equal(h.activations(), 0);
});

test("server identity change after restart is not accepted", async () => {
  const h = harness();
  let reads = 0;
  h.endpoint.health = async () => ({
    home_id: ++reads === 1 ? "installation-a" : "installation-b",
    protocol: PROTOCOL_VERSION,
  });
  assert.equal((await h.coordinator.install("2.1.0")).ok, false);
  assert.equal(h.activations(), 0);
});

test("a completed older plan does not prevent selecting the next release", async () => {
  const h = harness(undefined, "2.1.0");
  h.setState({
    running: "2.1.0",
    coordination: { target: "2.1.0", phase: "complete", running: "2.1.0" },
    coordination_protocol: 1,
    supported: true,
  });
  assert.equal((await h.coordinator.install("2.2.0")).ok, true);
  assert.equal(h.state().running, "2.2.0");
});

test("bundled local core uses only the Desktop bundle and retains quit activation", async () => {
  const h = harness();
  h.endpoint.local = true;
  h.endpoint.state = async () => {
    throw new Error("Must not contact the local updater");
  };
  assert.equal((await h.coordinator.install("2.1.0")).ok, true);
  assert.equal(h.stages(), 1);
  assert.equal(h.applies(), 0);
  assert.equal(h.coordinator.canApplyOnQuit(), true);
  await h.coordinator.restart();
  assert.equal(h.activations(), 1);
});
