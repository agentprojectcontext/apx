import "../../styles/screens.css";
import type { Part } from "@apx/protocol";
import { ActionGroup, Button, Icons } from "@apx/ui";
import { useState } from "react";
import { respond } from "../../data/actions.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";

const DONE: Record<Exclude<Extract<Part, { type: "input" }>["state"], "pending">, MessageKey> = {
  approved: "input.approved",
  denied: "input.denied",
  answered: "input.answered",
  expired: "input.expired",
  withdrawn: "input.withdrawn",
};

type InputPartData = Extract<Part, { type: "input" }>;

const DONE_ICON = {
  approved: Icons.Check,
  answered: Icons.Check,
  denied: Icons.X,
  expired: Icons.Clock,
  withdrawn: Icons.RotateCcw,
} as const;

/** An agent waiting for the owner: approve or decline an action, or answer a question. Once settled, one line. */
export function InputPart({ part }: { part: InputPartData }) {
  const { state } = part;
  if (state !== "pending") return <SettledInput part={part} state={state} />;
  return <PendingInput part={part} />;
}

/** What was asked and how it ended, in the actions' design: a line that opens to show what it was. */
function SettledInput({ part, state }: { part: InputPartData; state: Exclude<InputPartData["state"], "pending"> }) {
  const t = useT();
  const Icon = DONE_ICON[state];
  const what =
    part.kind === "confirm" ? t("input.asked", { tool: part.tool ?? t("input.anAction") }) : t("input.askedQuestion");
  return (
    <ActionGroup
      className={`turn__tools inputline is-${state}`}
      icon={part.kind === "confirm" ? <Icons.Hand size={14} /> : <Icons.MessageCircle size={14} />}
      title={
        <>
          {what}
          <span className={`inputline__state is-${state}`}>
            <Icon size={12} />
            {t(DONE[state])}
            {part.approval_scope === "session" && ` · ${t("input.sessionScope")}`}
            {part.approval_scope === "always" && ` · ${t("input.agentScope")}`}
            {part.answer && part.kind === "question" ? `: “${part.answer}”` : ""}
          </span>
        </>
      }
    >
      <div className="inputline__body">
        <p className="inputcard__prompt">{part.prompt}</p>
        {part.detail && <code className="inputcard__detail">{part.detail}</code>}
        {part.answer && part.kind === "confirm" && <p className="inputcard__answer">“{part.answer}”</p>}
      </div>
    </ActionGroup>
  );
}

function PendingInput({ part }: { part: InputPartData }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (a: { decision?: "approve" | "deny"; text?: string; scope?: "once" | "session" | "always" }) => {
    setBusy(true);
    await respond(part.input_id, a);
    setBusy(false);
  };
  return (
    <div className="inputcard is-pending" role="alert">
      <div className="inputcard__head">
        {part.kind === "confirm" ? <Icons.Hand size={16} /> : <Icons.MessageCircle size={16} />}
        <span className="inputcard__title">
          {t(part.kind === "confirm" ? "input.confirmTitle" : "input.questionTitle")}
        </span>
      </div>
      <p className="inputcard__prompt">{part.prompt}</p>
      {part.detail && <code className="inputcard__detail">{part.detail}</code>}
      {part.approval_scopes && <p className="resd__note">{t("input.scopeHelp")}</p>}
      {part.kind === "confirm" && (
        <div className="inputcard__actions">
          <Button size="sm" loading={busy} onClick={() => send({ decision: "approve" })}>
            {t(part.approval_scopes ? "input.approveOnce" : "input.approve")}
          </Button>
          {part.approval_scopes?.includes("session") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "session" })}
            >
              {t("input.approveSession")}
            </Button>
          )}
          {part.approval_scopes?.includes("always") && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => send({ decision: "approve", scope: "always" })}
            >
              {t("input.approveAlways")}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send({ decision: "deny" })}>
            {t("input.deny")}
          </Button>
        </div>
      )}
      {part.kind === "question" && (
        <form
          className="inputcard__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ text: text.trim() });
          }}
        >
          {part.options?.length ? (
            <div className="inputcard__options">
              {part.options.map((o) => (
                <Button key={o} size="sm" variant="secondary" disabled={busy} onClick={() => send({ text: o })}>
                  {o}
                </Button>
              ))}
            </div>
          ) : null}
          <input
            className="inputcard__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("input.answerPlaceholder")}
            aria-label={t("input.answerPlaceholder")}
            disabled={busy}
          />
        </form>
      )}
    </div>
  );
}
