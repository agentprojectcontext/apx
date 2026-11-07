import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type ObserverArchitecture = "arm64" | "x64";
type Run = (executable: string, args: readonly string[]) => string;
const run: Run = (executable, args) =>
  execFileSync(executable, [...args], { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
const sources = [
  "Contract.swift",
  "TargetValidation.swift",
  "Traversal.swift",
  "WindowSelection.swift",
  "NativeObserver.swift",
  "NativeSelection.swift",
  "Protocol.swift",
  "Transport.swift",
  "PointerOverlay.swift",
  "PointerAction.swift",
  "PointerRuntime.swift",
  "Main.swift",
];

/** Ad hoc signing checks consistency, not publisher identity or protection from replacement. */
export function buildObserverResource(config: {
  output: string;
  architectures: readonly ObserverArchitecture[];
  platform: string;
  run?: Run;
}): { kind: "unsupported" } | { kind: "built"; executable: string } {
  if (!path.isAbsolute(config.output)) throw new Error("INVALID_BUILD_OUTPUT");
  const destination = path.join(config.output, "computer-observer");
  const architectures = [...config.architectures];
  if (
    !architectures.length ||
    new Set(architectures).size !== architectures.length ||
    architectures.some((arch) => arch !== "arm64" && arch !== "x64")
  )
    throw new Error("INVALID_BUILD_ARCHITECTURES");
  let workspace: string;
  try {
    fs.mkdirSync(config.output, { recursive: true });
    fs.rmSync(destination, { force: true });
    if (config.platform !== "darwin") return { kind: "unsupported" };
    workspace = fs.mkdtempSync(path.join(config.output, ".observer-build-"));
  } catch {
    throw new Error("OBSERVER_BUILD_FAILED");
  }
  const execute = config.run ?? run;
  let failed = false;
  try {
    const parts: string[] = [];
    for (const architecture of architectures) {
      const arch = architecture === "x64" ? "x86_64" : "arm64";
      const part = path.join(workspace, arch);
      execute("/usr/bin/swiftc", [
        "-warnings-as-errors",
        "-parse-as-library",
        "-target",
        `${arch}-apple-macos12.0`,
        ...sources.map((name) => path.join(import.meta.dirname, "../native/computer-observer", name)),
        "-o",
        part,
      ]);
      // The file goes first: Xcode 26's lipo reads every word after -verify_arch as an architecture.
      execute("/usr/bin/lipo", [part, "-verify_arch", arch]);
      parts.push(part);
    }
    const binary = path.join(workspace, "computer-observer");
    const first = parts[0];
    if (!first) throw new Error("MISSING_BUILD_SLICE");
    if (parts.length === 1) fs.copyFileSync(first, binary);
    else execute("/usr/bin/lipo", ["-create", ...parts, "-output", binary]);
    const expected = architectures.map((arch) => (arch === "x64" ? "x86_64" : "arm64")).sort();
    const actual = execute("/usr/bin/lipo", ["-archs", binary]).trim().split(/\s+/).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("WRONG_ARCHITECTURES");
    fs.chmodSync(binary, 0o755);
    execute("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", "dev.apx.computer-observer", binary]);
    execute("/usr/bin/codesign", ["--verify", "--strict", binary]);
    fs.renameSync(binary, destination);
  } catch {
    failed = true;
  }
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {
    failed = true;
    try {
      fs.rmSync(destination, { force: true });
    } catch {
      // A filesystem refusal can prevent rollback; callers must abort rather than discover an existing binary.
    }
  }
  if (failed) throw new Error("OBSERVER_BUILD_FAILED");
  return { kind: "built", executable: destination };
}
