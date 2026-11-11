// What a WhatsApp message holds, as the library hands it, read into what APX keeps: its words (wrappers opened, a
// shared card or place as words), whom it @mentions and what it answers, and its file.
import path from "node:path";
import { menuText, WA_CONTAINERS } from "./whatsapp-menus.ts";

export type WaKey = {
  id?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
  /** In a group: who wrote it (often their private id), and their phone address when WhatsApp tells it. */
  participant?: string | null;
  participantAlt?: string | null;
};
/** What a message answers and whom it @mentions. */
type WaContext = {
  mentionedJid?: (string | null)[] | null;
  participant?: string | null;
  stanzaId?: string | null;
};
/** A file's size as the library hands it: a number, or a protobuf Long. */
type WaLength = number | { toNumber(): number } | null | undefined;
type WaFile = { mimetype?: string | null; fileLength?: WaLength; contextInfo?: WaContext | null };
type WaCard = { displayName?: string | null; vcard?: string | null };
type WaPlace = {
  degreesLatitude?: number | null;
  degreesLongitude?: number | null;
  name?: string | null;
  address?: string | null;
};
export type WaContent = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null; contextInfo?: WaContext | null } | null;
  imageMessage?: (WaFile & { caption?: string | null }) | null;
  videoMessage?: (WaFile & { caption?: string | null }) | null;
  /** A round video note. */
  ptvMessage?: WaFile | null;
  documentMessage?: (WaFile & { caption?: string | null; fileName?: string | null }) | null;
  audioMessage?: { ptt?: boolean | null; mimetype?: string | null } | null;
  stickerMessage?: WaFile | null;
  /** A contact card someone shared (one, or several at once). */
  contactMessage?: WaCard | null;
  contactsArrayMessage?: { contacts?: (WaCard | null)[] | null } | null;
  locationMessage?: WaPlace | null;
  liveLocationMessage?: WaPlace | null;
  /** An emoji on a message (`key.id`); empty text when it was taken off. */
  reactionMessage?: { key?: WaKey | null; text?: string | null } | null;
  ephemeralMessage?: { message?: WaContent | null } | null;
  viewOnceMessage?: { message?: WaContent | null } | null;
  viewOnceMessageV2?: { message?: WaContent | null } | null;
};
/** The words of a message, its wrappers (disappearing, view once) opened. */
export function unwrap(c: WaContent | null | undefined): WaContent | undefined {
  let cur = c ?? undefined;
  for (let i = 0; i < 6 && cur; i++) {
    const wrappers = cur as Record<string, { message?: WaContent | null } | null | undefined>;
    const inner = WA_CONTAINERS.map((k) => wrappers[k]?.message).find(Boolean);
    if (!inner) break;
    cur = inner;
  }
  return cur;
}
export function textOf(c: WaContent): string | undefined {
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    menuText(c) ??
    sharedText(c)
  );
}

/** A shared contact card or place, as words: the agent needs the name and number, not the vCard. */
function sharedText(c: WaContent): string | undefined {
  const cards = c.contactMessage ? [c.contactMessage] : (c.contactsArrayMessage?.contacts ?? []);
  const shown = cards
    .filter((k): k is WaCard => Boolean(k))
    .map(cardText)
    .filter(Boolean);
  if (shown.length) return shown.join("\n");
  const place = c.locationMessage ?? c.liveLocationMessage;
  if (!place) return undefined;
  const at =
    typeof place.degreesLatitude === "number" && typeof place.degreesLongitude === "number"
      ? `${place.degreesLatitude}, ${place.degreesLongitude}`
      : "";
  const said = [place.name, place.address, at].map((v) => String(v ?? "").trim()).filter(Boolean);
  return said.length ? `[location: ${said.join(" · ").slice(0, 300)}]` : undefined;
}
function cardText(k: WaCard): string {
  const lines = String(k.vcard ?? "").split(/\r?\n/);
  const field = (name: string) =>
    lines.filter((l) => l.toUpperCase().startsWith(name)).map((l) => l.slice(l.indexOf(":") + 1).trim());
  const name = k.displayName?.trim() || field("FN")[0] || "";
  // `TEL;waid=549…:+54 9 …`: the number as written, after the parameters.
  const phones = [...new Set(field("TEL").filter(Boolean))];
  const emails = field("EMAIL").filter(Boolean);
  const said = [name, ...phones, ...emails].filter(Boolean);
  return said.length ? `[contact: ${said.join(", ").slice(0, 300)}]` : "";
}

/** Whom a message @mentions and what it answers, from whichever kind of message carries them. */
export function contextOf(c: WaContent): WaContext | undefined {
  return (
    c.extendedTextMessage?.contextInfo ??
    c.imageMessage?.contextInfo ??
    c.videoMessage?.contextInfo ??
    c.documentMessage?.contextInfo ??
    c.stickerMessage?.contextInfo ??
    undefined
  );
}

/** A message's picture, video, sticker or document: what it is, the name it is kept under and its declared size. */
export type WaMedia = { kind: "photo" | "video" | "sticker" | "file"; name: string; mime: string; size: number };
const sizeOf = (n: WaLength) => (typeof n === "number" ? n : n ? n.toNumber() : 0);
const extOf = (mime: string, fallback: string) =>
  ({ "video/quicktime": "mov", "video/3gpp": "3gp", "image/jpeg": "jpg" })[mime] ??
  (/^[a-z]+\/([a-z0-9]{2,5})$/.exec(mime)?.[1] || fallback);
export function mediaOf(c: WaContent): WaMedia | undefined {
  const typed = (f: WaFile, fallback: string) => (f.mimetype ?? fallback).split(";")[0]?.trim() || fallback;
  const made = (kind: WaMedia["kind"], f: WaFile, fallback: string, base: string): WaMedia => {
    const mime = typed(f, fallback);
    return { kind, mime, name: `${base}.${extOf(mime, fallback.split("/")[1] ?? "bin")}`, size: sizeOf(f.fileLength) };
  };
  if (c.imageMessage) return made("photo", c.imageMessage, "image/jpeg", "photo");
  if (c.videoMessage) return made("video", c.videoMessage, "video/mp4", "video");
  if (c.ptvMessage) return made("video", c.ptvMessage, "video/mp4", "video");
  if (c.stickerMessage) return made("sticker", c.stickerMessage, "image/webp", "sticker");
  const d = c.documentMessage;
  if (!d) return undefined;
  const name = path.basename(String(d.fileName ?? "").replaceAll("\\", "/")).slice(0, 200) || "document";
  return { kind: "file", name, mime: typed(d, "application/octet-stream"), size: sizeOf(d.fileLength) };
}
