// iMessage on the owner's own Mac as a channel, like WhatsApp on their own phone: new messages are read from Messages'
// database (polled by ROWID) and answers go out through the Messages app. Reading needs Full Disk Access for the
// process running APX; sending asks macOS once for permission to control Messages. Only one-to-one chats are read.
// What it remembers (the last ROWID read) lives in the channel's folder, so a restart never answers old messages.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Inbound } from "../domain/channels.ts";
import { errorMessage } from "../errors.ts";
import { attributedText, systemIMessage } from "../imessage.ts";
import { numberedOptions, sleep } from "./net.ts";
import { type AdapterFactory, type AdapterIO, type ChannelAdapter, ChannelRefused, SendError } from "./types.ts";

const POLL_MS = 2000;
/** New messages handled per round (a flood waits for the next one). */
const PER_ROUND = 50;
const MAX_FILES = 4;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Images an agent can read; HEIC photos and other files are only named. */
const KEEP = /^image\/(png|jpeg|gif|webp)$/;
/** Messages' style for a group chat (a one-to-one chat is 45). */
const GROUP_STYLE = 43;

type Send = (to: string, text: string) => Promise<void>;
type InFile = NonNullable<Inbound["files"]>[number];
type Row = {
  id: number;
  guid: string;
  text: string | null;
  body: Uint8Array | null;
  handle: string | null;
  chat: string | null;
  style: number | null;
  files: number;
};

export function imessageAdapter(
  _config: Parameters<AdapterFactory>[0],
  _secret: string | undefined,
  opts: { dir: string; db?: string; pollMs?: number; send?: Send; platform?: string },
) {
  const db = opts.db ?? path.join(os.homedir(), "Library", "Messages", "chat.db");
  // Attachment paths are written as "~/Library/Messages/…": "~" is the home that holds this database.
  const home = path.resolve(path.dirname(db), "..", "..");
  const send: Send = opts.send ?? ((to, text) => systemIMessage({ db }).send(to, text));
  const stateFile = path.join(opts.dir, "imessage-state.json");
  const ac = new AbortController();
  const options = numberedOptions();
  let last = readLast(stateFile);
  let loop: Promise<void> | undefined;

  function open(): DatabaseSync {
    try {
      return new DatabaseSync(db, { readOnly: true });
    } catch (err) {
      throw new Error(
        `cannot read Messages (${errorMessage(err, 120)}): give the app running APX Full Disk Access in System Settings › Privacy & Security`,
      );
    }
  }

  function save(): void {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ last_rowid: last }), { mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  }

  function attachments(conn: DatabaseSync, message: number): { files: InFile[]; listed: string[] } {
    const rows = conn
      .prepare(
        `SELECT a.filename, a.mime_type AS mime, a.transfer_name AS name
           FROM attachment a JOIN message_attachment_join j ON j.attachment_id = a.ROWID
           WHERE j.message_id = ?`,
      )
      .all(message) as Array<{ filename: string | null; mime: string | null; name: string | null }>;
    const files: InFile[] = [];
    const listed: string[] = [];
    for (const a of rows) {
      const name = (a.name ?? path.basename(a.filename ?? "file")).slice(0, 120);
      const mime = a.mime ?? "application/octet-stream";
      const file = a.filename?.replace(/^~(?=\/)/, home);
      const size = file ? fs.statSync(file, { throwIfNoEntry: false })?.size : undefined;
      if (file && files.length < MAX_FILES && KEEP.test(mime) && size && size <= MAX_FILE_BYTES)
        files.push({ name, mime, data: fs.readFileSync(file).toString("base64") });
      else listed.push(`${name} (${mime})`);
    }
    return { files, listed };
  }

  /** One round: every message newer than the last read, oldest first. */
  function round(io: AdapterIO): void {
    const conn = open();
    try {
      const rows = conn
        .prepare(
          `SELECT m.ROWID AS id, m.guid, m.text, m.attributedBody AS body, h.id AS handle,
                  c.chat_identifier AS chat, c.style, m.cache_has_attachments AS files
             FROM message m
             LEFT JOIN handle h ON h.ROWID = m.handle_id
             LEFT JOIN chat_message_join cj ON cj.message_id = m.ROWID
             LEFT JOIN chat c ON c.ROWID = cj.chat_id
             WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.item_type = 0 AND m.associated_message_type = 0
             ORDER BY m.ROWID LIMIT ?`,
        )
        .all(last, PER_ROUND) as Row[];
      for (const r of rows) {
        last = Math.max(last, r.id);
        // One-to-one chats only: a group's messages never reach the agent.
        if (!r.handle || r.style === GROUP_STYLE || r.chat?.startsWith("chat")) continue;
        // An attachment stands in the text as U+FFFC.
        let text = (r.text ?? attributedText(r.body) ?? "").replace(/￼/g, "").trim();
        const { files, listed } = r.files ? attachments(conn, r.id) : { files: [] as InFile[], listed: [] as string[] };
        if (listed.length) text += `${text ? "\n" : ""}[attachments not kept: ${listed.join("; ")}]`;
        if (!text && !files.length) continue;
        const sender = { id: r.handle, name: r.handle };
        const picked = options.pick(r.handle, text);
        if (picked) io.action({ conversation: r.handle, sender, data: picked });
        else
          io.receive({
            external_id: r.guid,
            conversation: r.handle,
            sender,
            text,
            private: true,
            ...(files.length ? { files } : {}),
          });
      }
      if (rows.length) save();
    } finally {
      conn.close();
    }
  }

  async function run(io: AdapterIO): Promise<void> {
    let failing = false;
    while (!ac.signal.aborted && !io.signal.aborted) {
      try {
        round(io);
        if (failing) io.status("running");
        failing = false;
      } catch (err) {
        if (ac.signal.aborted || io.signal.aborted) return;
        failing = true;
        io.status("error", errorMessage(err, 200));
      }
      await sleep(opts.pollMs ?? POLL_MS, AbortSignal.any([ac.signal, io.signal]));
    }
  }

  return {
    caps: { typing: false, buttons: false, ownAccount: true },
    async start(io) {
      if ((opts.platform ?? process.platform) !== "darwin")
        throw new ChannelRefused("iMessage runs only on a Mac signed in to Messages");
      const conn = open();
      try {
        // First start: begin after what is already there, so history is never answered.
        if (!fs.existsSync(stateFile)) {
          const max = conn.prepare("SELECT MAX(ROWID) AS max FROM message").get() as { max: number | null };
          last = max.max ?? 0;
          save();
        }
      } finally {
        conn.close();
      }
      loop = run(io);
      return { account: "Messages on this Mac" };
    },
    async stop() {
      ac.abort();
      await loop?.catch(() => {});
    },
    async forget() {
      fs.rmSync(stateFile, { force: true });
    },
    async send(conversation, p, files = []) {
      // One message carries the text: a later attempt has nothing left to send.
      if (p.skip) return {};
      let text = options.text(conversation, p.text, p.buttons).trim();
      // Messages cannot be handed a file from a script reliably: the files are named instead.
      if (files.length) text += `${text ? "\n" : ""}[not sent: ${files.map((f) => f.name ?? f.kind).join(", ")}]`;
      if (!text) return {};
      try {
        await send(conversation, text);
      } catch (err) {
        // Killed by the timeout: Messages may have sent it anyway.
        const killed = (err as { killed?: boolean }).killed === true;
        throw new SendError(killed ? "uncertain" : "fatal", `Messages: ${errorMessage(err, 200)}`);
      }
      return {};
    },
  } satisfies ChannelAdapter;
}

function readLast(file: string): number {
  try {
    const n = (JSON.parse(fs.readFileSync(file, "utf8")) as { last_rowid?: unknown }).last_rowid;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
