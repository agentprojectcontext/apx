import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_CONSENT_TTL_MS, browserConsents } from "./browser-consents.ts";

const context = { tab: "tab1", epoch: "epoch1", origin: "https://example.com", run: "run1" };
const thread = "thread1";
const agent = "reader";

for (const scope of ["tab", "turn"] as const) {
  test(`${scope} consent permits three evaluations only inside the approved agent, chat and exact origin`, () => {
    const permissions = browserConsents(() => true);
    assert.equal(permissions.allows(context, thread, agent), false);
    permissions.grant(context, scope, thread, agent);
    for (let i = 0; i < 3; i++) assert.equal(permissions.allows(context, thread, agent), true);
    assert.equal(permissions.allows(context, "other-chat", agent), false);
    assert.equal(permissions.allows(context, thread, "other-agent"), false);
    for (const origin of ["http://example.com", "https://sub.example.com", "https://example.com:8443"])
      assert.equal(permissions.allows({ ...context, origin }, thread, agent), false);
    const grant = permissions.list()[0];
    assert.ok(grant);
    permissions.revoke(grant.key, thread, agent);
    assert.equal(permissions.allows(context, thread, agent), false);
  });

  test(`${scope} consent respects its time boundary and is never restored by another instance`, () => {
    let time = 0;
    const permissions = browserConsents(
      () => true,
      () => time,
    );
    permissions.grant(context, scope, thread, agent);
    time = BROWSER_CONSENT_TTL_MS - 1;
    assert.equal(permissions.allows(context, thread, agent), true);
    time++;
    if (scope === "tab") {
      assert.equal(permissions.allows(context, thread, agent), false);
      assert.deepEqual(permissions.list(), []);
    } else {
      time += BROWSER_CONSENT_TTL_MS * 10;
      assert.equal(
        permissions.allows(context, thread, agent),
        true,
        "turn consent has no extra timeout beyond the run",
      );
      assert.equal(permissions.list()[0]?.expires_at, undefined);
    }
    assert.equal(browserConsents(() => true).allows(context, thread, agent), false);
  });
}

test("tab permission cannot follow new tabs, a reused identifier, navigation away and back, or a closed chat", () => {
  const permissions = browserConsents(() => true);
  permissions.grant(context, "tab", thread, agent);
  assert.equal(permissions.allows({ ...context, tab: "other-tab" }, thread, agent), false);
  assert.equal(permissions.allows({ ...context, epoch: "new-epoch" }, thread, agent), false);
  assert.equal(permissions.allows(context, thread, agent), false, "observed navigation retires the old epoch");
  permissions.grant(context, "tab", thread, agent);
  permissions.endThread(thread);
  assert.equal(permissions.allows(context, thread, agent), false);
});

test("a pending approval cannot reactivate consent after a concurrent decline, revocation or chat closure", () => {
  for (const action of ["decline", "revoke", "close"] as const) {
    const permissions = browserConsents(() => true);
    const version = permissions.version(context, thread, agent);
    if (action === "decline") permissions.deny(context, thread, agent);
    if (action === "close") permissions.endThread(thread);
    if (action === "revoke") {
      permissions.grant(context, "tab", thread, agent, version);
      const grant = permissions.list()[0];
      assert.ok(grant);
      permissions.revoke(grant.key, thread, agent);
    }
    assert.throws(() => permissions.grant(context, "turn", thread, agent, version), /revoked or declined/);
    assert.deepEqual(permissions.list(), []);
  }
});

test("unrelated chats and agents do not invalidate another pending browser approval", () => {
  const permissions = browserConsents(() => true);
  const version = permissions.version(context, thread, agent);
  permissions.deny(context, "other-chat", agent);
  permissions.deny(context, thread, "other-agent");
  permissions.grant(context, "turn", thread, agent, version);
  assert.equal(permissions.allows(context, thread, agent), true);
});

test("turn permission covers new tabs on the approved origin but not the next run or a finished run", () => {
  let active = true;
  const permissions = browserConsents(() => active);
  permissions.grant(context, "turn", thread, agent);
  assert.equal(permissions.allows({ ...context, tab: "tab2", epoch: "epoch2" }, thread, agent), true);
  assert.equal(permissions.allows({ ...context, run: "run2" }, thread, agent), false);
  active = false;
  assert.equal(permissions.allows(context, thread, agent), false);
  assert.deepEqual(permissions.list(), []);
  assert.throws(() => permissions.grant(context, "turn", thread, agent), /original active turn/);
});
