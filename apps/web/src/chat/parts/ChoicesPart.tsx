import "../../styles/chat-cards.css";
import type { Part } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { send } from "../../data/actions.ts";
import { client } from "../../data/client.ts";
import { useData } from "../../data/state.ts";
import { updateAgent } from "../../data/team.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";

type Choices = Extract<Part, { type: "choices" }>;

/** What the owner's own answer box asks for, by question. */
const HINT: Record<Choices["for"], MessageKey> = {
  name: "choices.namePlaceholder",
  work: "choices.answerPlaceholder",
  personality: "choices.ownPlaceholder",
  help: "choices.answerPlaceholder",
};

/**
 * Answers to one question of getting to know the owner, until the chat moves on: a pick (or the owner's own words) is
 * kept and the next question comes (setup.onboard); the last answer goes to the agent as the owner's message. How it
 * talks also sets its personality. With no answers offered, the owner writes theirs.
 */
export function ChoicesPart({
  part,
  threadId,
  messageId,
  agentId,
}: {
  part: Choices;
  threadId: string;
  messageId: string;
  agentId: string | undefined;
}) {
  const t = useT();
  const last = useData((s) => s.messages[threadId]?.at(-1)?.id === messageId);
  const [own, setOwn] = useState<string | undefined>(part.options.length ? undefined : "");
  const [busy, setBusy] = useState(false);
  if (!last || !agentId) return null;
  const pick = async (value: string, label: string) => {
    setBusy(true);
    const kept = part.for !== "personality" || (await updateAgent(agentId, { personality: value.slice(0, 1000) }));
    if (kept) {
      const r = await client
        .call("setup.onboard", { step: part.for, answer: label.slice(0, 1000) })
        .catch(() => undefined);
      if (r?.say) await send(threadId, r.say).catch(() => {});
    }
    setBusy(false);
  };
  return (
    <div className="inputcard choices">
      <div className="inputcard__options">
        {part.options.map((o) => (
          <Button
            key={o.label}
            size="sm"
            variant="secondary"
            disabled={busy}
            title={o.value}
            onClick={() => void pick(o.value, o.label)}
          >
            {o.label}
          </Button>
        ))}
        {part.custom && own === undefined && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.Pencil size={14} />}
            disabled={busy}
            onClick={() => setOwn("")}
          >
            {t("choices.own")}
          </Button>
        )}
      </div>
      {own !== undefined && (
        <form
          className="inputcard__reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim()) void pick(own.trim(), own.trim());
          }}
        >
          <input
            className="inputcard__input"
            // biome-ignore lint/a11y/noAutofocus: opened by the owner's click, to type at once
            autoFocus
            value={own}
            maxLength={1000}
            onChange={(e) => setOwn(e.target.value)}
            placeholder={t(HINT[part.for])}
            aria-label={t(HINT[part.for])}
            disabled={busy}
          />
        </form>
      )}
    </div>
  );
}
