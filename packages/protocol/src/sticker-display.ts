// Display-only projections: stored messages, tool inputs and model trust envelopes stay untouched.
const OPEN_LINE = '<sticker named_by="a model that saw it" trust="untrusted">';
const CLOSE_LINE = "</sticker>";
const ENVELOPE =
  /^<sticker named_by="a model that saw it" trust="untrusted">\r?\n(\[sticker(?: \(18\+\))?(?:: [^\r\n]*)?\])\r?\n<\/sticker>(?:\r?\n|$)/gm;

export function stickerDisplayText(text: string): string {
  const displayed = text.replace(ENVELOPE, "$1\n");
  return displayed === text ? text : displayed.trim();
}

// Historical previews are capped at 160 characters, sometimes midway through generated metadata.
export function stickerPreviewNeedsSource(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const last = lines.at(-1) ?? "";
  return !lines.includes(OPEN_LINE) && last.startsWith("<") && OPEN_LINE.startsWith(last);
}

export function stickerPreviewText(text: string, source?: string): string {
  if (source?.startsWith(text) && stickerPreviewNeedsSource(text)) {
    const tail = source.slice(text.lastIndexOf("\n") + 1);
    if (!tail.startsWith(OPEN_LINE)) return text;
  }
  const lines = text.split(/\r?\n/);
  const displayed: string[] = [];
  let inside = false;
  for (const [index, line] of lines.entries()) {
    const last = index === lines.length - 1;
    if (line === OPEN_LINE) {
      inside = true;
    } else if (inside && (line === CLOSE_LINE || (last && line.startsWith("<") && CLOSE_LINE.startsWith(line)))) {
      inside = false;
    } else if (
      !(
        last &&
        (text.length === 160 ||
          line.startsWith('<sticker named_by="') ||
          (source !== undefined && stickerPreviewNeedsSource(text))) &&
        line.startsWith("<") &&
        OPEN_LINE.startsWith(line)
      )
    ) {
      displayed.push(line);
    }
  }
  return displayed.join("\n").trim();
}

export function withoutStickerNote(text: string): string {
  return text.replace(ENVELOPE, "\n").trim();
}
