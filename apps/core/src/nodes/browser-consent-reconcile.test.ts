import assert from "node:assert/strict";
import { test } from "node:test";
import type { TabInfo, ToolApproval } from "@apx/protocol";
import { bindBrowserEpoch } from "./browser-consent-binding.ts";
import { browserConsentCurrent, reconcileBrowserConsents } from "./browser-consent-reconcile.ts";

const grant = (key: string, scope: "tab" | "turn" = "tab", backend = "node1"): ToolApproval => ({
  key,
  scope,
  server: "apx",
  tool: "browser_evaluate",
  thread_id: "thread1",
  agent_id: "reader",
  browser: { tab: "tab1", epoch: bindBrowserEpoch(backend, "epoch1"), origin: "https://example.com", run: "run1" },
});
const tab: TabInfo = {
  tab: "tab1",
  url: "https://example.com/",
  title: "Example",
  profile: "shared",
  control: { kind: "idle" },
  consent_epoch: "epoch1",
};

for (const [name, backend, tabs] of [
  ["tab closure", "node1", []],
  ["reload or navigation", "node1", [{ ...tab, consent_epoch: "epoch2" }]],
  ["node replacement", "node2", [tab]],
  ["uncertain browser identity", "node1", [{ ...tab, consent_epoch: undefined }]],
  ["owner takeover", "node1", [{ ...tab, control: { kind: "user", since: "now" } }]],
] as Array<[string, string, TabInfo[]]>) {
  test(`${name} removes a tab consent from the active list without removing a turn or VM consent`, () => {
    const rows = [grant("tab"), grant("turn", "turn"), grant("vm", "tab", "vm:other-run")];
    const revoked: string[] = [];
    const store = {
      approvals: {
        list: () => rows,
        revoke: (key: string) => {
          revoked.push(key);
        },
      },
    };
    reconcileBrowserConsents(store, backend, tabs);
    assert.deepEqual(revoked, ["tab"]);
  });
}

for (const backend of ["node1", "vm:run1"]) {
  test(`${backend} lifecycle checks its exact origin and only retires its own browser family`, () => {
    const own = grant("own", "tab", backend);
    assert.ok(own.browser);
    assert.equal(browserConsentCurrent(own.browser, "reader", backend, [tab]), true);
    assert.equal(
      browserConsentCurrent(own.browser, "reader", backend, [{ ...tab, url: "https://other.example/" }]),
      false,
    );
    assert.equal(browserConsentCurrent(own.browser, "reader", backend, [{ ...tab, url: "not a URL" }]), false);
    assert.equal(browserConsentCurrent(own.browser, "reader", "different", [tab]), false);
    const revoked: string[] = [];
    reconcileBrowserConsents(
      {
        approvals: {
          list: () => [
            own,
            grant("shared", "tab", "other-node"),
            grant("other-vm", "tab", "vm:other-run"),
            grant("turn", "turn", backend),
          ],
          revoke: (key: string) => {
            revoked.push(key);
          },
        },
      },
      backend,
      [],
    );
    assert.deepEqual(revoked, backend.startsWith("vm:") ? ["own"] : ["own", "shared"]);
  });
}

test("unchanged tab identity retains the active consent", () => {
  const revoked: string[] = [];
  reconcileBrowserConsents(
    {
      approvals: {
        list: () => [grant("tab")],
        revoke: (key: string) => {
          revoked.push(key);
        },
      },
    },
    "node1",
    [tab],
  );
  assert.deepEqual(revoked, []);
});
