// What the model reads of the files the owner attached: text files inline (capped, as outside content: the owner
// chose the file, not its words), images as a line (the pixels go separately to models that can see), others named.
import fs from "node:fs";
import type { Attachment } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { ATTACHMENT_TEXT_CHARS, isReadable } from "../services/uploads.ts";
import { untrusted } from "../tools/result.ts";

/** A file name as plain text in the prompt: it cannot open a tag or a bracket of its own. */
const nameOf = (name: string) => name.replace(/[[\]<>\r\n]/g, " ").slice(0, 120);

export function attachmentsBlock(store: Store, files: Attachment[]): string {
  return files
    .map((raw) => {
      const f = { ...raw, name: nameOf(raw.name) };
      if (f.kind === "image") return `[image attached: ${f.name}. If you cannot see it, say so instead of guessing.]`;
      const m = store.media.get(f.media_id);
      if (!m || !isReadable(f.mime)) return `[file attached: ${f.name} (${f.mime}); its contents cannot be read here]`;
      let text: string;
      try {
        text = fs.readFileSync(m.path, "utf8");
      } catch {
        return `[file attached: ${f.name}; it is no longer on disk]`;
      }
      const cut = text.length > ATTACHMENT_TEXT_CHARS;
      const body = cut
        ? `${text.slice(0, ATTACHMENT_TEXT_CHARS)}\n[… ${text.length - ATTACHMENT_TEXT_CHARS} more characters not shown]`
        : text;
      return untrusted("attachment", { name: f.name, mime: f.mime }, body);
    })
    .join("\n\n");
}
