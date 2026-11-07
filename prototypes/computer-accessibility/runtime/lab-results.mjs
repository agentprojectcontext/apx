import assert from "node:assert/strict";

export function validateReadAudit(result, mode) {
  const audit = result.readAudit;
  assert.equal(audit.overflow, false, "READ_AUDIT_OVERFLOW");
  assert.equal(audit.filteredContentRequested, false, "FILTERED_CONTENT_REQUESTED");
  assert.equal(audit.attributeRequests.other, undefined, "UNEXPECTED_ATTRIBUTE_REQUESTED");
  for (const name of ["AXRole", "AXSubrole", "AXChildren", "AXWindow", "AXURL"]) {
    assert.ok(audit.attributeRequests[name] > 0, "READ_AUDIT_DID_NOT_OBSERVE_NATIVE_REQUESTS");
  }
  if (mode === "local") {
    assert.equal(audit.allowedDocuments, 2, "LOCAL_DOCUMENTS_NOT_AUDITED");
    assert.equal(audit.deniedDocuments, 0);
    assert.equal(audit.filteredNodes, 4, "LOCAL_INPUTS_NOT_AUDITED");
    assert.ok(audit.attributeRequests.AXTitle > 0, "LOCAL_TITLES_NOT_AUDITED");
  } else if (mode === "nested-iframe") {
    assert.equal(audit.allowedDocuments, 1, "NESTED_TEST_DID_NOT_CROSS_ALLOWED_ROOT");
    assert.equal(audit.deniedDocuments, 1, "NESTED_DOCUMENT_NOT_REJECTED");
    assert.ok(audit.filteredNodes >= 1, "DENIED_DOCUMENT_NOT_AUDITED");
  } else if (mode !== "navigate") {
    assert.equal(audit.allowedDocuments, 0);
    assert.equal(audit.deniedDocuments, 1);
    assert.ok(audit.filteredNodes >= 1, "DENIED_DOCUMENT_NOT_AUDITED");
  }
}

export function validateNavigationResult(result) {
  assert.equal(result.navigationPaused, true, "NAVIGATION_DID_NOT_PAUSE_AFTER_ALLOWED_ROOT");
  assert.equal(result.readAudit.allowedDocuments, 1, "NAVIGATION_ROOT_WAS_NOT_ACCEPTED_ONCE");
  assert.equal(result.error, "WINDOW_UNRESOLVED", "NAVIGATION_DID_NOT_REJECT_STALE_WINDOW_ASSOCIATION");
  assert.deepEqual(result.observations, []);
}
