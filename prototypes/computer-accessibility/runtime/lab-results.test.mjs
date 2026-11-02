import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNavigationResult, validateReadAudit } from "./lab-results.mjs";

function localAudit() {
  return {
    overflow: false,
    filteredContentRequested: false,
    allowedDocuments: 2,
    deniedDocuments: 0,
    filteredNodes: 4,
    attributeRequests: { AXRole: 36, AXSubrole: 36, AXChildren: 52, AXWindow: 110, AXURL: 2, AXTitle: 10 },
  };
}

test("audit requires real native requests and classified fixture inputs, not only false flags", () => {
  assert.doesNotThrow(() => validateReadAudit({ readAudit: localAudit() }, "local"));
  for (const attributeRequests of [{}, { ...localAudit().attributeRequests, AXTitle: 0 }]) {
    assert.throws(() => validateReadAudit({ readAudit: { ...localAudit(), attributeRequests } }, "local"));
  }
  for (const change of [
    { filteredNodes: 0 },
    { allowedDocuments: 0 },
    { overflow: true },
    { filteredContentRequested: true },
  ]) {
    assert.throws(() => validateReadAudit({ readAudit: { ...localAudit(), ...change } }, "local"));
  }
  assert.throws(() =>
    validateReadAudit(
      {
        readAudit: {
          ...localAudit(),
          attributeRequests: { ...localAudit().attributeRequests, other: 1 },
        },
      },
      "local",
    ),
  );
});

test("local and nested audits reject disconnected hooks and missing required native evidence", () => {
  const nested = { ...localAudit(), allowedDocuments: 1, deniedDocuments: 1, filteredNodes: 1 };
  assert.doesNotThrow(() => validateReadAudit({ readAudit: nested }, "nested-iframe"));
  for (const [mode, audit] of [
    ["local", localAudit()],
    ["nested-iframe", nested],
  ]) {
    for (const result of [{}, { readAudit: null }, { readAudit: { ...audit, attributeRequests: {} } }]) {
      assert.throws(() => validateReadAudit(result, mode));
    }
    for (const name of ["AXRole", "AXSubrole", "AXChildren", "AXWindow", "AXURL"]) {
      for (const value of [undefined, 0]) {
        const attributeRequests = { ...audit.attributeRequests, [name]: value };
        assert.throws(() => validateReadAudit({ readAudit: { ...audit, attributeRequests } }, mode));
      }
    }
    for (const change of [{ filteredNodes: 0 }, { allowedDocuments: 0 }, { deniedDocuments: 2 }]) {
      assert.throws(() => validateReadAudit({ readAudit: { ...audit, ...change } }, mode));
    }
  }
});

function observedResult() {
  return {
    navigationPaused: true,
    readAudit: { allowedDocuments: 1 },
    error: "WINDOW_UNRESOLVED",
    observations: [],
  };
}

test("navigation evidence requires the observed stale-window-association failure", () => {
  assert.doesNotThrow(() => validateNavigationResult(observedResult()));
});

test("unrelated native failures and successful output cannot establish navigation refusal", () => {
  for (const error of [undefined, "", "UNAVAILABLE", "DEADLINE_EXCEEDED", "LIMIT_EXCEEDED", "BROWSER_DENIED"]) {
    assert.throws(() => validateNavigationResult({ ...observedResult(), error }));
  }
});

test("missing handshake, vacuous root acceptance and partial observations are refused", () => {
  assert.throws(() => validateNavigationResult({ ...observedResult(), navigationPaused: false }));
  for (const allowedDocuments of [0, 2]) {
    assert.throws(() => validateNavigationResult({ ...observedResult(), readAudit: { allowedDocuments } }));
  }
  assert.throws(() => validateNavigationResult({ ...observedResult(), observations: [{ nodes: 1 }] }));
});
