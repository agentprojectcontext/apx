import { Fragment, type ReactNode } from "react";

/** An @mention as the core reads it (not inside an email or a longer word). */
export const MENTION = /(?<![\p{L}\p{N}_@])@[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;

/** Plain text with each @mention as a badge (`apx-mention`). */
export function withMentions(text: string, keyBase = "m"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(MENTION)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`${keyBase}t${n}`}>{text.slice(last, at)}</Fragment>);
    out.push(
      <span key={`${keyBase}m${n++}`} className="apx-mention">
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}end`}>{text.slice(last)}</Fragment>);
  return out;
}
