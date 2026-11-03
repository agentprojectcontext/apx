import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNativePointer } from "./native-pointer-check.ts";

for (const platform of ["win32", "linux"]) {
  test(`native pointer harness reports unsupported on ${platform}, not native test success`, async () => {
    assert.deepEqual(await checkNativePointer(platform), { kind: "unsupported" });
  });
}

test("native pointer harness reports actual platform coverage explicitly", async () => {
  const result = await checkNativePointer();
  assert.deepEqual(result, process.platform === "darwin" ? { kind: "passed", cases: 27 } : { kind: "unsupported" });
});
