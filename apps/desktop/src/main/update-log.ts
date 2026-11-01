// The app's own update steps, one line each, in <logs>/update.log: what to read when an update does not go in.
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 256 * 1024;

/** Writes synchronously: the line before a restart must be on disk before the app quits. */
export function updateLog(file: string): (line: string) => void {
  return (line) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // A log that cannot be written never stops an update.
    }
  };
}
