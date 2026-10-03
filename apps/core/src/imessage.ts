// iMessage on the owner's Mac, as tools (not a channel): reading recent messages from Messages' own database and
// sending one through the Messages app. Reading needs Full Disk Access for the process running APX; sending asks
// macOS once for permission to control Messages. Addresses and text go as arguments, never inside a script.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type IMessage = { handle: string; from_me: boolean; text: string; at: string };

export type IMessageOps = {
  recent(o: { with?: string | undefined; limit: number }): Promise<IMessage[]>;
  send(to: string, text: string): Promise<void>;
};

/** Messages stores dates as seconds (older macOS) or nanoseconds (newer) since 2001-01-01. */
const APPLE_EPOCH_S = 978_307_200;
export function appleDate(value: number | bigint): string {
  const n = Number(value);
  const seconds = n > 1e12 ? n / 1e9 : n;
  return new Date((seconds + APPLE_EPOCH_S) * 1000).toISOString();
}

/**
 * The text of a message newer macOS keeps only in `attributedBody` (an archived NSAttributedString): it follows the
 * "NSString" class name as a '+' marker and a length (one byte, or 0x81 and two bytes little-endian).
 */
export function attributedText(blob: Uint8Array | null | undefined): string | undefined {
  if (!blob) return undefined;
  const buf = Buffer.from(blob);
  const at = buf.indexOf("NSString");
  if (at < 0) return undefined;
  const plus = buf.indexOf(0x2b, at + 8);
  if (plus < 0 || plus > at + 20) return undefined;
  let len = buf[plus + 1] ?? 0;
  let start = plus + 2;
  if (len === 0x81) {
    len = buf.readUInt16LE(plus + 2);
    start = plus + 4;
  }
  const text = buf.subarray(start, start + len).toString("utf8");
  return text || undefined;
}

type Run = (cmd: string, args: string[]) => Promise<void>;
const execRun: Run = (cmd, args) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout: 20_000 }, (err) => (err ? reject(err) : resolve())));

// Sends through the signed-in iMessage account; the address and the words arrive as argv.
const SEND_SCRIPT = [
  "on run argv",
  'tell application "Messages"',
  "set svc to 1st account whose service type = iMessage",
  "send (item 2 of argv) to participant (item 1 of argv) of svc",
  "end tell",
  "end run",
];

/** The Mac's Messages: `db` and `run` are only replaced by tests. */
export function systemIMessage(o: { db?: string; run?: Run } = {}): IMessageOps {
  const db = o.db ?? path.join(os.homedir(), "Library", "Messages", "chat.db");
  const run = o.run ?? execRun;
  return {
    async recent({ with: who, limit }) {
      let conn: DatabaseSync;
      try {
        conn = new DatabaseSync(db, { readOnly: true });
      } catch (err) {
        throw new Error(
          `cannot read Messages (${(err as Error).message}): give the app running APX Full Disk Access in System Settings › Privacy & Security`,
        );
      }
      try {
        const stmt = conn.prepare(
          `SELECT m.text, m.attributedBody AS body, m.is_from_me AS me, m.date, h.id AS handle
             FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
             WHERE (? IS NULL OR h.id = ?) ORDER BY m.date DESC LIMIT ?`,
        );
        // Dates in nanoseconds pass 2^53: they are read as BigInt.
        stmt.setReadBigInts(true);
        const rows = stmt.all(who ?? null, who ?? null, limit * 2) as Array<{
          text: string | null;
          body: Uint8Array | null;
          me: bigint;
          date: number | bigint;
          handle: string | null;
        }>;
        return rows
          .flatMap((r) => {
            const text = (r.text ?? attributedText(r.body) ?? "").trim();
            return text ? [{ handle: r.handle ?? "", from_me: r.me === 1n, text, at: appleDate(r.date) }] : [];
          })
          .slice(0, limit)
          .reverse();
      } finally {
        conn.close();
      }
    },
    send(to, text) {
      return run("osascript", [...SEND_SCRIPT.flatMap((l) => ["-e", l]), to, text]);
    },
  };
}
