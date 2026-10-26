// How a message's pictures, videos and sounds are laid out on the phone. Pure, so node:test covers it.
import type { Message } from "../protocol";

type Part = Message["parts"][number];

/** A picture, video, sound or file in a message, whichever part it came in. */
export type MediaItem = {
  key: string;
  kind: "image" | "video" | "audio" | "file";
  /** Bytes in the core (media.get); absent for a picture from the web. */
  media_id?: string;
  /** A picture from the web. */
  url?: string;
  mime: string;
  name: string;
  bytes?: number;
};

/** What a message shows, in order: its own parts, and runs of pictures or videos gathered into one block. */
export type Row =
  | { kind: "part"; part: Part; key: string }
  | { kind: "images"; items: MediaItem[]; key: string }
  | { kind: "videos"; items: MediaItem[]; key: string }
  | { kind: "media"; item: MediaItem; key: string };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "application/pdf": "pdf",
};

/** The extension a saved copy gets: the file's own, else one for its type. */
export function extensionOf(mime: string, name = ""): string {
  const own = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return (own ?? EXT[mime.split(";")[0]?.trim() ?? ""] ?? "bin").toLowerCase();
}

/** The name a local copy gets: the file's own (safe for a file system), with an extension for its type. */
export function fileName(item: Pick<MediaItem, "name" | "mime">): string {
  const ext = extensionOf(item.mime, item.name);
  const base =
    item.name
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .trim() || "file";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/** Android infers the gallery collection from the URI extension, not the attachment's MIME or caption. */
export function galleryFileName(item: Pick<MediaItem, "kind" | "mime" | "name">): string | undefined {
  const mime = item.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXT[mime];
  if (!ext || (item.kind !== "image" && item.kind !== "video") || mime.split("/")[0] !== item.kind) return undefined;
  return `asset.${ext}`;
}

/** The media in a part, if it holds any (a document snapshot stays a document). */
export function mediaOf(part: Part, key: string): MediaItem | undefined {
  if (part.type === "image") {
    if (!part.media_id && !part.url) return undefined;
    const mime = part.mime ?? "image/jpeg";
    return {
      key,
      kind: "image",
      ...(part.media_id ? { media_id: part.media_id } : {}),
      ...(part.url ? { url: part.url } : {}),
      mime,
      name: part.alt || `image.${extensionOf(mime)}`,
    };
  }
  if (part.type === "audio")
    return { key, kind: "audio", media_id: part.media_id, mime: part.mime, name: `audio.${extensionOf(part.mime)}` };
  if (part.type === "file" && !part.document) {
    const kind = part.mime.startsWith("image/")
      ? "image"
      : part.mime.startsWith("video/")
        ? "video"
        : part.mime.startsWith("audio/")
          ? "audio"
          : "file";
    return { key, kind, media_id: part.media_id, mime: part.mime, name: part.name, bytes: part.bytes };
  }
  return undefined;
}

/**
 * A message's parts as rows: pictures next to each other become one grid, videos one carousel. Tool calls show in
 * their own group above, so they do not split a run.
 */
export function mediaRows(parts: readonly Part[]): Row[] {
  const rows: Row[] = [];
  const seen = new Map<string, number>();
  for (const part of parts) {
    if (part.type === "tool") continue;
    const base =
      part.type === "input" ? part.input_id : "media_id" in part && part.media_id ? part.media_id : part.type;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = `${base}:${n}`;
    const item = mediaOf(part, key);
    const last = rows.at(-1);
    if (item?.kind === "image" || item?.kind === "video") {
      const group = item.kind === "image" ? "images" : "videos";
      if (last?.kind === group) last.items.push(item);
      else rows.push({ kind: group, items: [item], key });
    } else if (item) rows.push({ kind: "media", item, key });
    else rows.push({ kind: "part", part, key });
  }
  return rows;
}

/**
 * How many tiles each row of a picture grid holds: one wide picture, a pair, one over two, two by two, and from five
 * on two over three (the last tile counts the ones left, all of them open in the viewer).
 */
export function mosaicRows(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [2];
  if (count === 3) return [1, 2];
  if (count === 4) return [2, 2];
  return [2, 3];
}

/** "4.2 MB" for a file size. */
export function sizeText(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
