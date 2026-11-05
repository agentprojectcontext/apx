import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { samePath } from "../../core/src/paths.ts";
import { tempDir } from "../../core/src/testkit/platform.ts";
import type { buildObserverResource } from "./build-computer-observer.ts";
import { prepareDesktopObserver } from "./prepare-computer-observer.ts";

test("native Desktop builds select a fixed private directory and the requested target slice", () => {
  for (const arch of ["arm64", "x64"]) {
    const output = path.resolve("dist");
    let observed: Parameters<typeof buildObserverResource>[0] | undefined;
    const result = prepareDesktopObserver({
      output,
      platform: "darwin",
      arch: "arm64",
      target: `mac-${arch}`,
      build: (config) => {
        observed = config;
        return { kind: "built", executable: path.join(config.output, "computer-observer") };
      },
    });
    assert.deepEqual(observed?.architectures, [arch]);
    assert.equal(observed?.platform, "darwin");
    assert.ok(observed && samePath(observed.output, path.join(output, "native")));
    assert.equal(result.kind, "built");
  }
});

test("a failed build aborts even when rollback leaves a helper at the expected path", (t) => {
  const temporary = tempDir("desktop-observer-consumer-");
  t.after(() => temporary.remove());
  const native = path.join(temporary.path, "native");
  const executable = path.join(native, "computer-observer");
  fs.mkdirSync(native);
  fs.writeFileSync(executable, "old or unverified binary");
  let continued = false;
  assert.throws(() => {
    prepareDesktopObserver({
      output: temporary.path,
      platform: "darwin",
      arch: "arm64",
      build: () => {
        throw new Error("OBSERVER_BUILD_FAILED");
      },
    });
    continued = true;
  }, /^Error: OBSERVER_BUILD_FAILED$/);
  assert.equal(continued, false);
  assert.equal(fs.readFileSync(executable, "utf8"), "old or unverified binary");
});

test("macOS packaging refuses unsupported output and non-macOS toolchains", () => {
  const output = path.resolve("dist");
  assert.throws(
    () =>
      prepareDesktopObserver({
        output,
        platform: "darwin",
        arch: "arm64",
        build: () => ({ kind: "unsupported" }),
      }),
    /^Error: MAC_OBSERVER_BUILD_REQUIRED$/,
  );
  for (const platform of ["linux", "win32"]) {
    let invoked = false;
    assert.throws(
      () =>
        prepareDesktopObserver({
          output,
          platform,
          arch: "x64",
          target: "mac-arm64",
          build: () => {
            invoked = true;
            return { kind: "unsupported" };
          },
        }),
      /^Error: MAC_OBSERVER_REQUIRES_MACOS_BUILD_HOST$/,
    );
    assert.equal(invoked, false);
  }
});

test("non-macOS targets never invoke a macOS toolchain and remove leftover native resources", (t) => {
  const temporary = tempDir("desktop-observer-nonmac-");
  t.after(() => temporary.remove());
  const native = path.join(temporary.path, "native");
  const executable = path.join(native, "computer-observer");
  fs.mkdirSync(native);
  for (const target of ["linux-x64", "win-arm64"]) {
    fs.writeFileSync(executable, "mac resource");
    assert.deepEqual(
      prepareDesktopObserver({
        output: temporary.path,
        platform: "darwin",
        arch: "arm64",
        target,
      }),
      { kind: "unsupported" },
    );
    assert.equal(fs.existsSync(executable), false);
  }
});

test("invalid targets and unexpected build output are not accepted", () => {
  const output = path.resolve("dist");
  let invoked = false;
  assert.throws(
    () =>
      prepareDesktopObserver({
        output,
        platform: "darwin",
        arch: "arm64",
        target: "mac-unknown",
        build: () => {
          invoked = true;
          return { kind: "unsupported" };
        },
      }),
    /^Error: INVALID_DESKTOP_BUILD_TARGET$/,
  );
  assert.equal(invoked, false);
  assert.throws(
    () =>
      prepareDesktopObserver({
        output,
        platform: "linux",
        arch: "x64",
        build: () => ({ kind: "built", executable: "ignored" }),
      }),
    /^Error: UNEXPECTED_OBSERVER_RESOURCE$/,
  );
});
