import assert from "node:assert/strict";
import { test } from "node:test";
import { viewerConfig } from "./config.ts";

test("viewer builds require an explicit project and never mix real projects with an emulator", () => {
  assert.throws(() => viewerConfig({}), /explicitly/);
  for (const project of ["../other", "", "UPPERCASE", "demo-apx-artifacts"]) {
    assert.throws(() => viewerConfig({ VITE_ARTIFACT_FIREBASE_PROJECT: project }));
  }
  assert.throws(() => viewerConfig({ VITE_ARTIFACT_FIREBASE_PROJECT: "acme-artifacts", VITE_ARTIFACT_EMULATOR: "1" }));
  assert.deepEqual(viewerConfig({ VITE_ARTIFACT_FIREBASE_PROJECT: "acme-artifacts" }), {
    projectId: "acme-artifacts",
    emulator: false,
  });
  assert.deepEqual(
    viewerConfig({ VITE_ARTIFACT_FIREBASE_PROJECT: "demo-apx-artifacts", VITE_ARTIFACT_EMULATOR: "1" }),
    { projectId: "demo-apx-artifacts", emulator: true },
  );
});
