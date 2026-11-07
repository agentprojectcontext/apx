import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { samePath } from "../../core/src/paths.ts";
import { tempDir } from "../../core/src/testkit/platform.ts";
import { buildObserverResource } from "./build-computer-observer.ts";

function fixture(t: TestContext, options: { archs?: string; fail?: string } = {}) {
  const temporary = tempDir("observer-resource-");
  const output = temporary.path;
  t.after(() => temporary.remove());
  const calls: { executable: string; args: string[] }[] = [];
  const run = (executable: string, args: readonly string[]) => {
    calls.push({ executable, args: [...args] });
    const stage = executable.endsWith("swiftc") ? "compile" : args.find((a) => a.startsWith("-"));
    if (stage === options.fail) throw new Error("SYNTHETIC_PRIVATE_TOOLCHAIN_ERROR");
    if (stage === "compile" || stage === "-create") {
      const flag = stage === "compile" ? "-o" : "-output";
      const destination = args[args.indexOf(flag) + 1];
      assert.ok(destination);
      fs.writeFileSync(destination, "synthetic executable");
    }
    return stage === "-archs" ? (options.archs ?? "arm64") : "";
  };
  return { output, run, calls, destination: path.join(output, "computer-observer") };
}

test("a single-architecture resource is published only after architecture and signature checks", (t) => {
  const f = fixture(t);
  const result = buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64"] });
  assert.equal(result.kind, "built");
  assert.ok(result.kind === "built" && samePath(result.executable, f.destination));
  assert.equal(fs.readFileSync(f.destination, "utf8"), "synthetic executable");
  assert.deepEqual(fs.readdirSync(f.output), ["computer-observer"]);
  assert.equal(f.calls.filter((call) => call.executable.endsWith("swiftc")).length, 1);
  assert.deepEqual(
    f.calls.slice(-2).map((call) => call.args[0]),
    ["--force", "--verify"],
  );
});

test("each slice is checked with its file before -verify_arch, as every Xcode's lipo reads it", (t) => {
  const f = fixture(t, { archs: "x86_64 arm64" });
  buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64", "x64"] });
  const checks = f.calls.filter((call) => call.args.includes("-verify_arch")).map((call) => call.args);
  assert.equal(checks.length, 2);
  for (const [file, flag, arch, ...rest] of checks) {
    assert.equal(flag, "-verify_arch");
    assert.ok(file && arch && path.basename(file) === arch, `the slice ${file} is named before its architecture`);
    assert.deepEqual(rest, [], "nothing after the architecture: lipo would read it as one");
  }
});

test("a universal resource contains both requested architectures before signing", (t) => {
  const f = fixture(t, { archs: "x86_64 arm64" });
  const result = buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64", "x64"] });
  assert.equal(result.kind, "built");
  assert.equal(f.calls.filter((call) => call.executable.endsWith("swiftc")).length, 2);
  assert.ok(f.calls.some((call) => call.args.includes("x86_64-apple-macos12.0")));
  assert.equal(f.calls.filter((call) => call.args[0] === "-create").length, 1);
  assert.deepEqual(fs.readdirSync(f.output), ["computer-observer"]);
});

for (const platform of ["linux", "win32"]) {
  test(`${platform} does not invoke a macOS toolchain or retain an old resource`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.destination, "old helper");
    assert.deepEqual(buildObserverResource({ ...f, platform, architectures: ["arm64"] }), { kind: "unsupported" });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(fs.readdirSync(f.output), []);
  });
}

for (const fail of ["compile", "-verify_arch", "-create", "-archs", "--force", "--verify"]) {
  test(`failure during ${fail} leaves no reusable helper or intermediate output`, (t) => {
    const f = fixture(t, { fail });
    fs.writeFileSync(f.destination, "old helper");
    assert.throws(
      () => buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64", "x64"] }),
      /^Error: OBSERVER_BUILD_FAILED$/,
    );
    assert.deepEqual(fs.readdirSync(f.output), []);
  });
}

for (const archs of ["x86_64", "arm64 x86_64", "arm64 arm64", "", "arm64 unknown"]) {
  test(`unexpected architecture inventory ${JSON.stringify(archs)} is not published`, (t) => {
    const f = fixture(t, { archs });
    assert.throws(
      () => buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64"] }),
      /^Error: OBSERVER_BUILD_FAILED$/,
    );
    assert.equal(
      f.calls.some((call) => call.executable.endsWith("codesign")),
      false,
    );
    assert.deepEqual(fs.readdirSync(f.output), []);
  });
}

test("empty or duplicate architecture requests are rejected before invoking tools", (t) => {
  const f = fixture(t);
  for (const architectures of [[], ["arm64", "arm64"]] as const)
    assert.throws(
      () => buildObserverResource({ ...f, platform: "darwin", architectures }),
      /^Error: INVALID_BUILD_ARCHITECTURES$/,
    );
  assert.equal(f.calls.length, 0);
});

for (const operation of ["mkdirSync", "rmSync", "mkdtempSync"] as const) {
  test(`filesystem refusal during ${operation} aborts without invoking the toolchain`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.destination, "old helper");
    t.mock.method(fs, operation, () => {
      throw new Error("SYNTHETIC_PRIVATE_FILESYSTEM_ERROR");
    });
    try {
      assert.throws(
        () => buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64"] }),
        /^Error: OBSERVER_BUILD_FAILED$/,
      );
      assert.equal(f.calls.length, 0);
      assert.equal(fs.existsSync(f.destination), operation !== "mkdtempSync");
    } finally {
      t.mock.restoreAll();
    }
  });
}

for (const rollbackDenied of [false, true]) {
  test(`cleanup failure rejects publication even when rollback is ${rollbackDenied ? "denied" : "available"}`, (t) => {
    const f = fixture(t);
    const remove = fs.rmSync;
    let cleanupFailed = false;
    t.mock.method(fs, "rmSync", (target: fs.PathLike, options?: fs.RmOptions) => {
      if (path.basename(String(target)).startsWith(".observer-build-") && !cleanupFailed) {
        cleanupFailed = true;
        throw new Error("SYNTHETIC_PRIVATE_CLEANUP_ERROR");
      }
      if (cleanupFailed && rollbackDenied && samePath(String(target), f.destination))
        throw new Error("SYNTHETIC_PRIVATE_REMOVAL_ERROR");
      return remove(target, options);
    });
    assert.throws(
      () => buildObserverResource({ ...f, platform: "darwin", architectures: ["arm64"] }),
      /^Error: OBSERVER_BUILD_FAILED$/,
    );
    assert.equal(cleanupFailed, true);
    assert.equal(fs.existsSync(f.destination), rollbackDenied);
  });
}

test("a relative build destination is refused before invoking tools", (t) => {
  const f = fixture(t);
  assert.throws(
    () => buildObserverResource({ ...f, output: "relative", platform: "darwin", architectures: ["arm64"] }),
    /^Error: INVALID_BUILD_OUTPUT$/,
  );
  assert.equal(f.calls.length, 0);
});
