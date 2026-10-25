import type { Part } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { appPlace } from "../chat/appLinks.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";
import { HandBack } from "./HandBack.tsx";

type NoticeData = Extract<Part, { type: "notice" }>;

/**
 * What the core says about the computer in a chat (a refused turn, a stop, the owner's take of control), in the owner's
 * language: its strings come with the computer's pack, loaded only when a chat has one.
 */
function ComputerNoticeBody({ part }: { part: NoticeData }) {
  const t = useT();
  const key = `notice.${part.code}${part.vars?.variant ? `.${part.vars.variant}` : ""}` as MessageKey;
  const text = t(key, part.vars);
  const link = typeof part.vars?.link === "string" ? appPlace(part.vars.link) : undefined;
  if (part.level !== "error") {
    const Icon = part.level === "warn" ? Icons.TriangleAlert : Icons.Info;
    return (
      <div className={`noticeline is-${part.level}`} role="status">
        <Icon size={14} />
        <span className="noticeline__text">{text}</span>
      </div>
    );
  }
  return (
    <div className="notice notice--error" role="alert">
      {text}
      {part.detail && <pre className="notice__detail">{part.detail}</pre>}
      {part.code === "computer.manual" && typeof part.vars?.screen === "number" && (
        <HandBack screen={part.vars.screen} />
      )}
      {link && (
        <Button size="sm" variant="secondary" className="notice__action" onClick={link.open}>
          {t("notice.computer.notAllowed.link")}
        </Button>
      )}
    </div>
  );
}

export function ComputerNotice(props: { part: NoticeData }) {
  return usePack("computer") ? <ComputerNoticeBody {...props} /> : null;
}
