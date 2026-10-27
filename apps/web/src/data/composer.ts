// The composer's calls: attaching files, dictating into the field and the chat's own model.
import type { ModelChoice } from "@apx/protocol";
import { UPLOAD_LIMITS } from "@apx/protocol/client";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { chooseNewChatModel, isNewChat } from "./newChat.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

/** A file stored by the core, ready to go with the next message. */
export type Attached = { id: string; kind: "image" | "audio" | "file"; name: string; mime: string; bytes: number };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Browsers leave `type` empty for many text files; the extension says what they are.
const BY_EXT: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  xml: "application/xml",
  html: "text/html",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  py: "text/plain",
  sh: "text/plain",
  sql: "text/plain",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
  aac: "audio/aac",
};

export function mimeOf(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  return BY_EXT[file.name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Over the size the core takes for its kind: the message to show, or undefined when it fits. */
export function tooBig(file: { name: string; size: number; type: string }): string | undefined {
  const mime = mimeOf(file);
  const limit = isImage(mime)
    ? UPLOAD_LIMITS.imageBytes
    : mime.startsWith("audio/")
      ? UPLOAD_LIMITS.audioBytes
      : UPLOAD_LIMITS.fileBytes;
  return file.size > limit ? t("composer.tooBig", { name: file.name, mb: Math.round(limit / 1024 / 1024) }) : undefined;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = "";
  // In slices: String.fromCharCode over megabytes at once overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Uploads one file; throws the core's reason (wrong type, too big, empty) for the chip to show. */
/** `thread` is left out for a new chat: the file goes with its first message all the same. */
export async function upload(
  file: File,
  thread: string | undefined,
  options?: { taskAsset?: boolean },
): Promise<Attached> {
  const big = tooBig(file);
  if (big) throw new Error(big);
  const { media } = await client.call("media.upload", {
    name: file.name,
    mime: mimeOf(file),
    data: await base64(file),
    ...(options?.taskAsset ? { task_asset: true } : thread ? { thread } : {}),
  });
  return { id: media.id, kind: media.kind, name: media.name, mime: media.mime, bytes: media.bytes };
}

/** Speech to text for the field; undefined (with a notice) when it could not be heard. */
export async function transcribe(mediaId: string, thread: string | undefined): Promise<string | undefined> {
  try {
    const r = await client.call("media.transcribe", { media_id: mediaId, ...(thread ? { thread } : {}) });
    return r.text.trim();
  } catch (e) {
    notify(t("composer.dictationFailed", { error: errText(e) }));
    return undefined;
  }
}

/**
 * What the microphone has heard so far, while it still records. undefined when it cannot be heard live (no engine on
 * this machine, or it failed): the words still come when it stops.
 */
export async function listen(audio: Blob): Promise<{ text: string; live: boolean } | undefined> {
  try {
    return await client.call("media.listen", { data: await base64(audio), mime: audio.type });
  } catch {
    return undefined;
  }
}

/** The chat's own model; null goes back to the agent's. A new chat keeps it until it is made. */
export async function setThreadModel(thread: string, choice: ModelChoice | null): Promise<void> {
  if (isNewChat(thread)) return chooseNewChatModel(thread, choice);
  try {
    const r = await client.call("threads.model", { thread, model_choice: choice });
    data.set((s) => {
      const cur = s.threads[thread];
      return cur ? { threads: { ...s.threads, [thread]: { ...cur, model_choice: r.model_choice } } } : {};
    });
  } catch (e) {
    notify(t("error.changeModel", { error: errText(e) }));
  }
}
