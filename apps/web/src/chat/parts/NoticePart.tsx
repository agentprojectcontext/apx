import type { Part } from "@apx/protocol";
import { isKey, useT } from "../../i18n/index.ts";

/** Something the system says about a turn (interrupted, fallback engine, no answer). Never the agent's words. */
export function NoticePart({ part }: { part: Extract<Part, { type: "notice" }> }) {
  const t = useT();
  const key = `notice.${part.code}`;
  // The core's English text carries details (e.g. the error); the translation is used when it is the plain case.
  const text = isKey(key) && !part.text.includes(":") ? t(key) : part.text;
  return (
    <div className={`notice notice--${part.level}`} role={part.level === "error" ? "alert" : "status"}>
      {text}
    </div>
  );
}
