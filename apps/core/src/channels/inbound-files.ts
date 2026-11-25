import { UPLOAD_LIMITS } from "@apx/protocol";
import type { Inbound } from "../domain/channels.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import { saveUpload } from "../services/uploads.ts";
import { inlineName, untrusted } from "../tools/result.ts";
import type { Stickers } from "./stickers.ts";
import type { ChannelConfig } from "./types.ts";

/** Keeps the original words and records which suffixes ingestion, rather than the sender, appended. */
export async function inboundFiles(
  deps: { home: string; store: Store; stickers: Pick<Stickers, "keep"> },
  platform: ChannelConfig["type"],
  thread: string,
  files: Inbound["files"],
  quiet: boolean,
  text: string,
  attachments: string[],
): Promise<{ text: string; notes: string[] }> {
  const notes: string[] = [];
  for (const file of files ?? []) {
    try {
      attachments.push(
        saveUpload(
          deps.home,
          deps.store,
          { name: file.name, mime: file.mime, bytes: Buffer.from(file.data, "base64"), thread },
          file.mime.startsWith("image/") ? undefined : UPLOAD_LIMITS.channelBytes,
        ).id,
      );
    } catch (err) {
      text += `\n[attachment could not be accepted: ${errorMessage(err, 200)}]`;
    }
    if (file.sticker) {
      const s = await deps.stickers.keep(platform, file, thread, !quiet);
      const said = `[sticker${s?.adult ? " (18+)" : ""}${s?.meaning ? `: ${inlineName(s.meaning, 160)}` : ""}]`;
      const note = s?.meaning ? untrusted("sticker", { named_by: "a model that saw it" }, said) : said;
      notes.push(note);
      text = `${text}\n${note}`.trim();
    }
  }
  return { text, notes };
}
