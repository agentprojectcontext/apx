import type { Part } from "@apx/protocol";
import { ActionGroup, Button, Icons } from "@apx/ui";
import { Suspense } from "react";
import { isKey, useT } from "../../i18n/index.ts";
import { DelegationActions, GoOn } from "../../lazy.ts";
import { appPlace } from "../appLinks.ts";

type NoticeData = Extract<Part, { type: "notice" }>;

/**
 * Something the system says about a turn (interrupted, another model took over, no answer). Never the agent's words.
 * An error shows in full. A note or a warning is one line in the actions' design: it folds only when it has more to
 * say (the error behind a model switch), otherwise the line is the whole notice.
 */
export function NoticePart({ part }: { part: NoticeData }) {
  const t = useT();
  // A `variant` picks one wording of the code (`notice.<code>.<variant>`).
  const key = `notice.${part.code}${part.vars?.variant ? `.${part.vars.variant}` : ""}`;
  // The core's English text carries details (e.g. the error); the translation is used when it is the plain case.
  const text = isKey(key) && (part.vars || !part.text.includes(":")) ? t(key, part.vars) : part.text;
  // A `link` (apx:settings/…) is where the owner changes what the notice is about, labelled `notice.<code>.link`.
  const linkKey = `notice.${part.code}.link`;
  const linkLabel = isKey(linkKey) ? t(linkKey) : undefined;
  const open = typeof part.vars?.link === "string" && linkLabel ? appPlace(part.vars.link)?.open : undefined;
  const thread = part.code.startsWith("breaker.") && typeof part.vars?.thread === "string" ? part.vars.thread : "";
  // A delegated run that hit a limit: its session to open and, while APX keeps it going, to stop.
  const session =
    part.code === "delegation.limit" && typeof part.vars?.subthread === "string" ? part.vars.subthread : "";
  const link = (thread || open || session) && (
    <span className="noticeline__actions">
      {thread && (
        <Suspense fallback={null}>
          <GoOn thread={thread} />
        </Suspense>
      )}
      {session && (
        <Suspense fallback={null}>
          <DelegationActions key={session} session={session} />
        </Suspense>
      )}
      {open && (
        <Button size="sm" variant="ghost" className="noticeline__link" onClick={open}>
          {linkLabel}
        </Button>
      )}
    </span>
  );
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
        <span className="noticeline__text">{text}</span>
        {link}
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
        {link}
      </div>
    </ActionGroup>
  );
}
