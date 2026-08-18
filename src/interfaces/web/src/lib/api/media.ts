import { getToken } from "../http";
import type { MessageMedia } from "../../types/daemon";
import { t } from "../../i18n";

/**
 * Authenticated blob URL for an attachment that arrived over a channel.
 *
 * The daemon sandboxes /media to ~/.apx/media, so the caller passes the
 * absolute path recorded on the turn. A blob (rather than a token in the URL)
 * because <audio>/<img> cannot carry the bearer header, and the token has no
 * business sitting in a src attribute.
 */
export async function fetchMediaUrl(filePath: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api/media?path=${encodeURIComponent(filePath)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`media ${res.status}: ${detail.slice(0, 160)}`);
  }
  return URL.createObjectURL(await res.blob());
}

/** What the daemon stored for a file the composer is about to send. */
export interface UploadedMedia {
  path: string;
  name: string;
  mime: string;
  kind: MessageMedia["kind"];
  size: number;
}

/**
 * What may be attached, and how much of it. Kept in step with the allowlist in
 * host/daemon/api/media.js — the daemon is the one that enforces it; this copy
 * exists so a rejected file says so before it is uploaded, and so the file
 * picker offers the right set in the first place.
 */
const ALLOWED_EXT = [
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
  ".oga", ".ogg", ".opus", ".mp3", ".wav", ".m4a", ".aac",
  ".mp4", ".mov", ".webm",
  ".pdf", ".txt", ".md", ".csv", ".json", ".log",
];
const MAX_UPLOAD = 25 * 1024 * 1024;

export const ATTACH_ACCEPT = ALLOWED_EXT.join(",");

// A pasted screenshot arrives as a File with no useful name (Chrome says
// "image.png", Safari says nothing at all), so the extension comes from the
// mime type instead. Without this, Cmd+V dropped the paste on the floor: no
// extension, no allowlist match.
const EXT_FOR_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
};

/** The filename to send this file under: its own, or one built from its type. */
export function attachmentName(file: File): string {
  const own = (file.name || "").trim();
  if (own && /\.[a-z0-9]{1,5}$/i.test(own)) return own;
  const ext = EXT_FOR_MIME[file.type] || "";
  const stem = own.replace(/[^\w.\- ]+/g, "_") || "pasted";
  return `${stem}${ext}`;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Why this file cannot be sent, or null when it can. */
export function attachmentRejection(file: File): string | null {
  const ext = extensionOf(attachmentName(file));
  if (!ext || !ALLOWED_EXT.includes(ext)) {
    return t("chat_ui.attach_bad_type", { ext: ext || "?" });
  }
  if (file.size > MAX_UPLOAD) {
    return t("chat_ui.attach_too_big", { mb: String(MAX_UPLOAD / (1024 * 1024)) });
  }
  return null;
}

/**
 * Store a file under ~/.apx/media so a turn can name it. Raw bytes, not
 * multipart: one file per request, and the name rides in the query.
 */
export async function uploadMedia(file: File): Promise<UploadedMedia> {
  const rejected = attachmentRejection(file);
  if (rejected) throw new Error(rejected);
  const token = getToken();
  const res = await fetch(`/api/media/upload?name=${encodeURIComponent(attachmentName(file))}`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(detail.error || `upload ${res.status}`);
  }
  return res.json();
}
