import fs from "node:fs";

/**
 * Read all of stdin, synchronously.
 *
 * The CLI convention across commands is a `-` flag value (`--prompt -`,
 * `--body -`) or a bare flag (`apx memory <slug> --replace`) meaning "the text
 * comes from a pipe". Long multi-line content — an agent's system prompt, a
 * session body, a memory file — is unusable as a shell argument, so a pipe is
 * the only sane way to hand it over.
 *
 * Sync on purpose: these are one-shot CLI commands that have nothing to do
 * until the input has arrived, and fd 0 reads are what `apx foo < file` and
 * `cat x | apx foo` both resolve to.
 */
export function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      const bytes = fs.readSync(0, buf, 0, buf.length);
      if (!bytes) break;
      chunks.push(buf.subarray(0, bytes).toString("utf8"));
    }
  } catch {
    // EOF on a closed/absent stdin (EAGAIN on a TTY) — whatever arrived is it.
  }
  return chunks.join("");
}
