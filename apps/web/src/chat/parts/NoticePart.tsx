import type { Part } from "@apx/protocol";
import { ActionGroup, Icons } from "@apx/ui";
import { isKey, useT } from "../../i18n/index.ts";

type NoticeData = Extract<Part, { type: "notice" }>;

/**
 * Something the system says about a turn (interrupted, another model took over, no answer). Never the agent's words.
 * An error shows in full. A note or a warning is one line in the actions' design: it folds only when it has more to
 * say (the error behind a model switch), otherwise the line is the whole notice.
 */
export function NoticePart({ part }: { part: NoticeData }) {
  const t = useT();
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
  const Icon = part.level === "warn" ? Icons.TriangleAlert : Icons.Info;
  const titleKey = `notice.${part.code}.title`;
  if (!isKey(titleKey) && !part.detail)
    return (
      <div className={`noticeline is-${part.level}`} role="status">
        <Icon size={14} />
        <span>{text}</span>
      </div>
    );
  const to = part.vars?.to;
  return (
    <ActionGroup
      className={`turn__tools turn__notice is-${part.level}`}
      icon={<Icon size={14} />}
      title={
        <>
          {isKey(titleKey) ? t(titleKey) : t(part.level === "warn" ? "notice.warn" : "notice.info")}
          {to ? <span className="turn__notice-to">{to}</span> : null}
        </>
      }
    >
      <div className="turn__notice-body">
        {text}
        {part.detail && <pre className="notice__detail">{part.detail}</pre>}
      </div>
    </ActionGroup>
  );
}
