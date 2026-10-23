import fs from "node:fs";
import path from "node:path";

// Files the owner opens with APX (double-click, "Open with", dropped on the Dock icon): kept until the panel takes them.

/** The file types APX registers; only .apxart installs today. */
export const OPENED_EXTS = [".apxart", ".apxapp", ".apxext"] as const;
/** Larger than any artifact with its memory; a bigger file is refused unread. */
export const OPENED_MAX_BYTES = 64 * 1024 * 1024;

export type OpenedFile = { name: string; text?: string; error?: "too-big" | "unreadable" };

const isOpenable = (p: string) => OPENED_EXTS.some((ext) => p.toLowerCase().endsWith(ext));

/** The APX files named in a launch's arguments (Windows and Linux pass an opened file this way). */
export function openedIn(argv: readonly string[], exists: (p: string) => boolean = fs.existsSync): string[] {
  return argv.filter((a) => !a.startsWith("-") && isOpenable(a) && exists(a)).map((a) => path.resolve(a));
}

/** What the panel gets for each file: its text, or why it has none. */
export function readOpened(file: string, max = OPENED_MAX_BYTES): OpenedFile {
  const name = path.basename(file);
  try {
    if (fs.statSync(file).size > max) return { name, error: "too-big" };
    return { name, text: fs.readFileSync(file, "utf8") };
  } catch {
    return { name, error: "unreadable" };
  }
}

/** The queue: files arrive before the panel exists, and more while it runs. */
export function openedQueue(onAdded: () => void) {
  const pending: string[] = [];
  return {
    add(files: readonly string[]): void {
      const fresh = [...new Set(files)].filter((f) => isOpenable(f) && !pending.includes(f));
      if (!fresh.length) return;
      pending.push(...fresh);
      onAdded();
    },
    take(): OpenedFile[] {
      return pending.splice(0).map((f) => readOpened(f));
    },
  };
}
