import { MENTION } from "@apx/ui";
import { Fragment, type ReactNode } from "react";

// What reads as a tag in the field: a command or skill first ("/compact", "/pdf"), a connector ("$linear") and an
// @mention. Built from the mention's own pattern so both read the same.
const TAGS = new RegExp(
  `^\\/[\\p{L}\\p{N}][\\p{L}\\p{N}_.-]*|(?<![^\\s])\\$[\\p{L}\\p{N}][\\p{L}\\p{N}_.:-]*|${MENTION.source}`,
  "gu",
);

/** The field's text with each tag drawn as a chip behind it (the letters themselves do not move). */
export function composerMarks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TAGS)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${n}`}>{text.slice(last, at)}</Fragment>);
    out.push(
      <span key={`m${n++}`} className="apx-mention">
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return out;
}
