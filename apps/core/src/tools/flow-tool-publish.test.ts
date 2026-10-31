// The owner asks the super-agent to turn a Flow on and try it: publishing and running by hand each wait for a card that
// says what it will do (DECISIONS.md#d-184), and turning on a drawing never published is refused before anyone is asked.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
let flow = "";
let version = 0;
before(async () => {
  h = await settingsCore({ tool: "apx_flow" });
  const acme = (await h.env.client.call("projects.create", { name: "Acme" })).project.id;
  await h.env.client.call("tables.create", { project: acme, name: "leads", columns: ["email"] });
  const { answer } = await h.ask({
    method: "flows.create",
    params: {
      project: acme,
      name: "New leads",
      edits: [
        { op: "add", step: { kind: "webhook", id: "hook", label: "New lead" } },
        {
          op: "add",
          after: "hook",
          step: {
            kind: "table_write",
            id: "save",
            label: "Save the lead",
            table: "leads",
            key: "$trigger.email",
            columns: [{ name: "email", value: "$trigger.email" }],
          },
        },
        {
          op: "add",
          after: "save",
          step: { kind: "cmd", id: "cmd", label: "Log it", command: "printf ok" },
        },
      ],
    },
  });
  // A save given columns drops the whole-value default a new step starts with, so it can run as drawn.
  assert.match(answer, /It can run as drawn/);
  flow = /flow ([a-z0-9-]+),/.exec(answer)?.[1] ?? "";
  version = (await h.env.client.call("flows.graph_get", { flow })).draftVersion ?? 0;
  assert.ok(flow && version, answer);
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const def = () => h.env.core.store.flows.get(flow);

test("turning on a drawing never published is refused: it would run nothing", async () => {
  const current = def();
  assert.ok(current);
  const { answer } = await h.ask({ method: "flows.set", params: { id: flow, enabled: true } });
  assert.match(answer, /does not publish its drawing: flows\.publish does both/);
  assert.equal(def()?.enabled, false);
});

test("running a Flow that is off is refused before anyone is asked", async () => {
  const { answer } = await h.ask({ method: "flows.run_now", params: { flow, data: { email: "ana@example.com" } } });
  assert.match(answer, /it is off: publish it first/);
});

test("a stale draft version is refused before the card", async () => {
  const { answer } = await h.ask({ method: "flows.publish", params: { flow, expectedDraftVersion: version + 5 } });
  assert.match(answer, new RegExp(`the draft is at version ${version}`));
});

test("publishing waits for the owner's card, which says what it runs; declined, nothing runs", async () => {
  const { detail } = await h.ask({ method: "flows.publish", params: { flow, expectedDraftVersion: version } }, "deny");
  assert.match(detail, /^Publish New leads and turn it on/);
  assert.match(detail, /Runs `printf ok` on this computer/);
  assert.equal((await h.env.client.call("flows.graph_get", { flow })).publishedRevision, null);
  assert.equal(def()?.enabled, false);
});

test("approved, the draft runs and the Flow is on; a run by hand saves the row", async () => {
  const published = await h.ask(
    { method: "flows.publish", params: { flow, expectedDraftVersion: version } },
    "approve",
  );
  assert.match(published.answer, /^done: version 1 of New leads runs and the Flow is on/);
  assert.equal((await h.env.client.call("flows.graph_get", { flow })).publishedRevision, 1);
  assert.equal(def()?.enabled, true);

  const ran = await h.ask({ method: "flows.run_now", params: { flow, data: { email: "ana@example.com" } } }, "approve");
  assert.match(ran.detail, /^Run New leads now/);
  assert.match(ran.detail, /With this data: \{"email":"ana@example\.com"\}/);
  const event = /started, event (\S+):/.exec(ran.answer)?.[1];
  assert.ok(event, ran.answer);
  const run = await waitFor(async () => {
    const r = await h.env.client.call("flows.run_get", { flow, event });
    return r.state === "succeeded" ? r : undefined;
  }, "the run to finish");
  assert.deepEqual(
    run.steps.map((s) => [s.node, s.state]),
    [
      ["hook", "succeeded"],
      ["save", "succeeded"],
      ["cmd", "succeeded"],
    ],
  );
});
