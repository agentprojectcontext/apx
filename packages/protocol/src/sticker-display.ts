// Display-only projections: the stored message and the model's trust envelope stay untouched.
const OPEN_LINE = '<sticker named_by="a model that saw it" trust="untrusted">';
const OPEN = /^<sticker named_by="a model that saw it" trust="untrusted">\r?\n/gm;
const CLOSE = /^<\/sticker>(?:\r?\n|$)/gm;

export function stickerDisplayText(text: string): string {
  const opened = text.replace(OPEN, "");
  return opened === text ? text : opened.replace(CLOSE, "").trim();
}

// Older previews were capped before projection and can end midway through an envelope line.
export function stickerPreviewText(text: string): string {
  const displayed = stickerDisplayText(text);
  const lines = displayed.split("\n");
  const last = lines.at(-1) ?? "";
  if (
    (last.startsWith("<sticker") && OPEN_LINE.startsWith(last)) ||
    (displayed !== text && last.startsWith("</") && "</sticker>".startsWith(last))
  ) {
    lines.pop();
    return lines.join("\n").trim();
  }
  return displayed;
}

export function withoutStickerNote(text: string): string {
  return stickerDisplayText(text)
    .replace(/^\[sticker(?: \(18\+\))?(?:: [^\n]*)?\]$/gm, "")
    .trim();
}
