import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ComputerHost, LIMA_VERSION } from "./host.ts";
import type { ComputerProgress } from "./lifecycle.ts";
import { limaProcess } from "./lima-process.ts";

/** A pinned vendor archive, checked before extracting only the native driver and matching guest agent. */
export async function installLima(
  host: ComputerHost,
  root: string,
  signal: AbortSignal,
  progress: (value: ComputerProgress) => void,
  download: typeof fetch = fetch,
) {
  const destination = path.join(root, `lima-${LIMA_VERSION}`);
  const binary = path.join(destination, host.limactl);
  if (fs.existsSync(binary)) return binary;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(root, ".lima-install-"));
  try {
    const url = `https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/${host.archive.name}`;
    const response = await download(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    if (!response.ok || !response.body) throw new Error(`Lima download failed: HTTP ${response.status}`);
    const archive = path.join(staging, host.os === "win32" ? "runtime.zip" : "runtime.tar.gz");
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
    if (hash.digest("hex") !== host.archive.sha256) throw new Error("Lima checksum does not match the pinned release");
    signal.throwIfAborted();
    const unpacked = path.join(staging, "unpacked");
    fs.mkdirSync(unpacked);
    await limaProcess(() => host.tar, {
      ...process.env,
      // GNU tar runs gzip from PATH.
      PATH: [path.dirname(host.tar), "/usr/bin", "/bin"].join(path.delimiter),
    })(["-xf", archive, "-C", unpacked, ...host.members], { signal });
    fs.renameSync(unpacked, destination);
    return binary;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
