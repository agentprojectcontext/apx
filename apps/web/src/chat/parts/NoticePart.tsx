import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useState } from "react";
import { isKey, useT } from "../../i18n/index.ts";

/**
 * Something the system says about a turn (interrupted, another model took over, no answer). Never the agent's words.
 * An error shows in full; a note or a warning is one small line that opens on click, so turns are not boxed in.
 */
export function NoticePart({ part }: { part: Extract<Part, { type: "notice" }> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const key = `notice.${part.code}`;
  // The core's English text carries details (e.g. the error); the translation is used when it is the plain case.
  const text = isKey(key) && (part.vars || !part.text.includes(":")) ? t(key, part.vars) : part.text;
  if (part.level === "error")
    return (
      <div className="notice notice--error" role="alert">
        {text}
        {part.detail && <pre className="notice__detail">{part.detail}</pre>}
      </div>
    );
  const shortKey = `notice.${part.code}.short`;
  const short = isKey(shortKey) ? t(shortKey, part.vars) : t(part.level === "warn" ? "notice.warn" : "notice.info");
  const Icon = part.level === "warn" ? Icons.TriangleAlert : Icons.Info;
  return (
    <div className={`noticeline noticeline--${part.level}`} role="status">
      <button type="button" className="noticeline__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon size={13} />
        <span className="noticeline__label">{short}</span>
        <Icons.ChevronRight size={12} className="noticeline__chev" />
      </button>
      {open && (
        <div className={`notice notice--${part.level}`}>
          {text}
          {part.detail && <pre className="notice__detail">{part.detail}</pre>}
        </div>
      )}
    </div>
  );
}
