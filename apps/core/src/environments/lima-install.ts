import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ComputerProgress } from "./lifecycle.ts";
import { limaProcess } from "./lima-process.ts";

export const LIMA_VERSION = "2.2.1";
const ARCHIVE = `https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-Darwin-arm64.tar.gz`;
const DIGEST = "9e9eacce88f37e185c346bad73aa6136f738d8cdf8c3bb23cd42b071824bc66e";

/** A pinned vendor archive, checked before extracting only the native driver and matching guest agent. */
export async function installLima(
  root: string,
  signal: AbortSignal,
  progress: (value: ComputerProgress) => void,
  download: typeof fetch = fetch,
) {
  const destination = path.join(root, `lima-${LIMA_VERSION}`);
  const binary = path.join(destination, "bin/limactl");
  if (fs.existsSync(binary)) return binary;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(root, ".lima-install-"));
  try {
    const response = await download(ARCHIVE, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    if (!response.ok || !response.body) throw new Error(`Lima download failed: HTTP ${response.status}`);
    const archive = path.join(staging, "runtime.tar.gz");
    const file = await fs.promises.open(archive, "wx", 0o600);
    const hash = createHash("sha256");
    let downloaded = 0;
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        downloaded += chunk.length;
        if (downloaded > 64 * 1024 * 1024) throw new Error("Lima archive exceeds download limit");
        hash.update(chunk);
        await file.writeFile(chunk);
        progress({ step: "runtime", downloaded, total: Number(response.headers.get("content-length")) || undefined });
      }
    } finally {
      await file.close();
    }
    if (hash.digest("hex") !== DIGEST) throw new Error("Lima checksum does not match the pinned release");
    signal.throwIfAborted();
    const unpacked = path.join(staging, "unpacked");
    fs.mkdirSync(unpacked);
    await limaProcess(() => "/usr/bin/tar", { PATH: "/usr/bin:/bin" })(
      [
        "-xzf",
        archive,
        "-C",
        unpacked,
        "./bin/limactl",
        "./share/lima/lima-guestagent.Linux-aarch64.gz",
        "./share/doc/lima/LICENSE",
        "./share/doc/lima/VERSION",
      ],
      { signal },
    );
    fs.renameSync(unpacked, destination);
    return binary;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
