import type { Part } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { respond } from "../../data/actions.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";

const DONE: Record<Exclude<Extract<Part, { type: "input" }>["state"], "pending">, MessageKey> = {
  approved: "input.approved",
  denied: "input.denied",
  answered: "input.answered",
  expired: "input.expired",
};

/** An agent waiting for the owner: approve or decline an action, or answer a question. */
export function InputPart({ part }: { part: Extract<Part, { type: "input" }> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = part.state === "pending";
  const send = async (a: { decision?: "approve" | "deny"; text?: string }) => {
    setBusy(true);
    await respond(part.input_id, a);
    setBusy(false);
  };
  return (
    <div className={`inputcard is-${part.state}`} role={pending ? "alert" : undefined}>
      <div className="inputcard__head">
        {part.kind === "confirm" ? <Icons.Hand size={16} /> : <Icons.MessageCircle size={16} />}
        <span className="inputcard__title">
          {t(part.kind === "confirm" ? "input.confirmTitle" : "input.questionTitle")}
        </span>
        {part.state !== "pending" && <span className="inputcard__state">{t(DONE[part.state])}</span>}
      </div>
      <p className="inputcard__prompt">{part.prompt}</p>
      {part.detail && <code className="inputcard__detail">{part.detail}</code>}
      {part.answer && !pending && <p className="inputcard__answer">“{part.answer}”</p>}
      {pending && part.kind === "confirm" && (
        <div className="inputcard__actions">
          <Button size="sm" loading={busy} onClick={() => send({ decision: "approve" })}>
            {t("input.approve")}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => send({ decision: "deny" })}>
            {t("input.deny")}
          </Button>
        </div>
      )}
      {pending && part.kind === "question" && (
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
