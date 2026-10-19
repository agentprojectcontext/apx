import { createHash } from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { parseSha256, type ReleaseAsset } from "@apx/protocol";

const MAX_DOWNLOAD = 1024 * 1024 * 1024;

export async function downloadDesktop(opts: {
  asset: ReleaseAsset;
  assets: ReleaseAsset[];
  file: string;
  signal: AbortSignal;
  fetch: typeof fetch;
  progress: (received: number, total?: number) => void;
}): Promise<void> {
  const sum = opts.assets.find((a) => a.name === `${opts.asset.name}.sha256`);
  if (!sum) throw new Error("The desktop download has no checksum");
  const digest = await opts.fetch(sum.url, { signal: opts.signal });
  if (!digest.ok) throw new Error(`Checksum download: HTTP ${digest.status}`);
  const reader = digest.body?.getReader();
  let sumText = "";
  if (!reader) throw new Error("The checksum download is empty");
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      sumText += new TextDecoder().decode(value);
      if (sumText.length > 4096) throw new Error("The checksum is too large");
    }
  } finally {
    await reader.cancel();
  }
  const want = parseSha256(sumText);
  if (!want) throw new Error("The desktop checksum is invalid");
  const response = await opts.fetch(opts.asset.url, { signal: opts.signal });
  if (!response.ok || !response.body) throw new Error(`Desktop download: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  const total = length > 0 && Number.isSafeInteger(length) ? length : undefined;
  if (total && total > MAX_DOWNLOAD) {
    await response.body.cancel();
    throw new Error("The desktop download is too large");
  }
  const hash = createHash("sha256");
  let received = 0;
  opts.progress(0, total);
  await pipeline(
    async function* () {
      for await (const chunk of response.body as ReadableStream<Uint8Array>) {
        received += chunk.byteLength;
        if (received > MAX_DOWNLOAD) throw new Error("The desktop download is too large");
        hash.update(chunk);
        opts.progress(received, total);
        yield chunk;
      }
    },
    fs.createWriteStream(opts.file, { flags: "wx", mode: 0o600 }),
    { signal: opts.signal },
  );
  if (total && received !== total) throw new Error("The desktop download was interrupted");
  if (hash.digest("hex") !== want) throw new Error("The desktop download does not match its checksum");
}
