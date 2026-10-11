import type { Part } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { send } from "../../data/actions.ts";
import { useData } from "../../data/state.ts";
import { updateAgent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

type Choices = Extract<Part, { type: "choices" }>;

/**
 * Answers the agent offers, until the chat moves on: a pick (or the owner's own words) sets the agent's personality,
 * then goes to the agent as the owner's reply.
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
  const [own, setOwn] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!last || !agentId) return null;
  const pick = async (personality: string, said: string) => {
    setBusy(true);
    if (await updateAgent(agentId, { personality: personality.slice(0, 1000) }))
      await send(threadId, t("choices.personality", { choice: said })).catch(() => {});
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
            placeholder={t("choices.ownPlaceholder")}
            aria-label={t("choices.ownPlaceholder")}
            disabled={busy}
          />
        </form>
      )}
    </div>
  );
}
