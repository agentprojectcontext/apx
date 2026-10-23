// A message's pictures and videos as blocks of their own: side by side they form one grid or one carousel.
import type { Part } from "@apx/protocol";

export type ImageLike = Extract<Part, { type: "image" }> | Extract<Part, { type: "file" }>;
export type VideoPart = Extract<Part, { type: "file" }>;

export type MediaBlock =
  | { kind: "images"; parts: ImageLike[]; key: string }
  | { kind: "videos"; parts: VideoPart[]; key: string }
  | { kind: "part"; part: Part; index: number };

const isImage = (p: Part): p is ImageLike =>
  p.type === "image" ? Boolean(p.media_id || p.url) : p.type === "file" && !p.document && p.mime.startsWith("image/");
const isVideo = (p: Part): p is VideoPart => p.type === "file" && !p.document && p.mime.startsWith("video/");

/** `skip`: parts shown elsewhere (tool calls fold into their own group), which do not split a run of media. */
export function mediaBlocks(parts: readonly Part[], skip: (p: Part) => boolean = () => false): MediaBlock[] {
  const out: MediaBlock[] = [];
  parts.forEach((part, index) => {
    if (skip(part)) return;
    const last = out.at(-1);
    if (isImage(part)) {
      if (last?.kind === "images") last.parts.push(part);
      else out.push({ kind: "images", parts: [part], key: `m:${index}` });
    } else if (isVideo(part)) {
      if (last?.kind === "videos") last.parts.push(part);
      else out.push({ kind: "videos", parts: [part], key: `m:${index}` });
    } else out.push({ kind: "part", part, index });
  });
  return out;
}

/** Voice notes and the files that are not pictures or videos (those show as media blocks), shown in a bubble. */
export function bubbleFiles(parts: readonly Part[]): Array<Extract<Part, { type: "file" | "audio" }>> {
  return parts.filter(
    (p): p is Extract<Part, { type: "file" | "audio" }> =>
      p.type === "audio" || (p.type === "file" && (Boolean(p.document) || !/^(image|video)\//.test(p.mime))),
  );
}

/**
 * A channel message that was only files says so in words for the agent, and a sticker says what it means; where the
 * files show, those words go.
 */
export function withoutFilesNote(parts: readonly Part[], text: string): string {
  const attached = parts.some((p) => p.type === "file" || p.type === "image" || p.type === "audio");
  if (!attached) return text;
  return text.trim() === "[attached files]" ? "" : text.replace(/^\[sticker(?:: [^\]\n]*)?\]$/gm, "").trim();
}
