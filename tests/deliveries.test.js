// The delivery queue store — record, cross off, fold to current state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apx-deliveries-"));
process.env.HOME = TMP;
process.env.APX_HOME = path.join(TMP, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { recordDelivery, markDelivery, answerDeliveries, listDeliveries, DELIVERY_STATUS } =
  await import("#core/stores/deliveries.js");

function fresh() {
  const dir = fs.mkdtempSync(path.join(TMP, "store-"));
  return dir;
}

test("recordDelivery — a new delivery starts pending and carries its fields", () => {
  const s = fresh();
  const id = recordDelivery(s, { agent: "golf-coach", agentName: "Golf Coach", routine: "golf-am", notify: "Tip: y to L", priority: true });
  assert.ok(id, "returns an id");
  const q = listDeliveries(s);
  assert.equal(q.length, 1);
  assert.equal(q[0].status, DELIVERY_STATUS.PENDING);
  assert.equal(q[0].agent, "golf-coach");
  assert.equal(q[0].agent_name, "Golf Coach");
  assert.equal(q[0].notify, "Tip: y to L");
  assert.equal(q[0].priority, true);
});

test("markDelivery — crosses a delivery off, latest event wins", () => {
  const s = fresh();
  const id = recordDelivery(s, { agent: "coach", routine: "r", notify: "x" });
  markDelivery(s, id, DELIVERY_STATUS.NOTIFIED, { channel: "telegram" });
  const q = listDeliveries(s);
  assert.equal(q.length, 1, "still one row — folded, not duplicated");
  assert.equal(q[0].status, DELIVERY_STATUS.NOTIFIED);
  assert.equal(q[0].channel, "telegram");
  // A later answer moves it again.
  markDelivery(s, id, DELIVERY_STATUS.ANSWERED);
  assert.equal(listDeliveries(s)[0].status, DELIVERY_STATUS.ANSWERED);
});

test("listDeliveries — filters by status and keeps the descriptive fields", () => {
  const s = fresh();
  const a = recordDelivery(s, { agent: "a", routine: "r", notify: "na" });
  recordDelivery(s, { agent: "b", routine: "r", notify: "nb" });
  markDelivery(s, a, DELIVERY_STATUS.HELD, { reason: "quiet-hours" });

  const held = listDeliveries(s, { status: DELIVERY_STATUS.HELD });
  assert.equal(held.length, 1);
  assert.equal(held[0].agent, "a");
  assert.equal(held[0].reason, "quiet-hours");
  assert.equal(held[0].notify, "na", "the pending event's fields survive the status change");

  const pending = listDeliveries(s, { status: DELIVERY_STATUS.PENDING });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].agent, "b");
});

test("answerDeliveries — a reply closes that agent's open deliveries, leaves others", () => {
  const s = fresh();
  const a1 = recordDelivery(s, { agent: "coach", routine: "r", notify: "x1" });
  recordDelivery(s, { agent: "coach", routine: "r", notify: "x2" }); // second pending
  const other = recordDelivery(s, { agent: "magui", routine: "r", notify: "y" });
  markDelivery(s, a1, DELIVERY_STATUS.NOTIFIED); // already notified — still closes

  const closed = answerDeliveries(s, "coach");
  assert.equal(closed, 2, "both of coach's open deliveries closed");
  const coach = listDeliveries(s).filter((d) => d.agent === "coach");
  assert.ok(coach.every((d) => d.status === DELIVERY_STATUS.ANSWERED));
  // Another agent's delivery is untouched.
  assert.equal(listDeliveries(s).find((d) => d.id === other).status, DELIVERY_STATUS.PENDING);
});

test("answerDeliveries — nothing open is a no-op", () => {
  const s = fresh();
  assert.equal(answerDeliveries(s, "nobody"), 0);
  assert.equal(answerDeliveries(s, ""), 0);
});

test("listDeliveries — empty / missing store is just an empty list", () => {
  assert.deepEqual(listDeliveries(fresh()), []);
  assert.deepEqual(listDeliveries(""), []);
});
