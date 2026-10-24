import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { COMPUTER_GRANT } from "@apx/protocol";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  h = await settingsCore({ computer: { limaHome: path.join("/unused", "no-vms"), instance: "missing" } });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const allowed = async () =>
  (await h.env.client.call("tools.approvals", {})).approvals
    .filter((g) => g.key === COMPUTER_GRANT)
    .map((g) => g.agent_id);

test("the super-agent tells who may use the computer and turns it on for an agent once the owner approves", async () => {
  assert.match((await h.ask({ method: "environments" })).answer, /environments\.permit: let an agent use the isolated/);
  assert.match((await h.ask({ method: "environments.status" })).answer, /^No agent may use the computer yet\./);

  const on = { method: "environments.permit", params: { agent: "scout", on: true } };
  const declined = await h.ask(on, "deny");
  assert.equal(declined.detail, "Let Scout use the isolated computer\nIt starts its own screen when it needs one");
  assert.deepEqual(await allowed(), []);
  await h.ask(on, "approve");
  assert.deepEqual(await allowed(), ["scout"]);
  assert.match((await h.ask({ method: "environments.status" })).answer, /May use the computer:\n- Scout \[scout\]/);
  // Already so: answered without asking the owner again.
  assert.match((await h.ask(on)).answer, /already is so/);

  const off = await h.ask({ method: "environments.permit", params: { agent: "scout", on: false } }, "approve");
  assert.equal(off.detail, "Take the isolated computer away from Scout\nIts grants for single chats end too");
  assert.deepEqual(await allowed(), []);
});
