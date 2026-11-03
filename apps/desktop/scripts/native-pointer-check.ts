import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tempDir } from "../../core/src/testkit/platform.ts";

/** Platform-specific harness results are explicit, never a claim of native coverage on another OS. */
export async function checkNativePointer(
  platform: string = process.platform,
): Promise<{ kind: "unsupported" } | { kind: "passed"; cases: number }> {
  if (platform !== "darwin") return { kind: "unsupported" };
  await using folder = tempDir("apx-native-pointer-tests-");
  const native = path.resolve(import.meta.dirname, "../native/computer-observer");
  const executable = path.join(folder.path, "pointer-tests");
  execFileSync(
    "/usr/bin/swiftc",
    [
      "-warnings-as-errors",
      "-parse-as-library",
      ...["PointerAction.swift", "PointerOverlay.swift", "PointerTests.swift"].map((file) => path.join(native, file)),
      "-o",
      executable,
    ],
    { timeout: 120000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = execFileSync(executable, [], { encoding: "utf8", timeout: 10000 });
  assert.match(output, /27 pointer behavior tests passed/);
  return { kind: "passed", cases: 27 };
}
