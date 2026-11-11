// The owner's words their agent has not taken yet, in the chat: a message sent while it works says it waits, with
// "Send now" and "Remove" in one short line; once taken, two ticks and "Now". Those in line for its next turn sit
// above the composer instead (composer/QueueTray.tsx).
import type { Message as Msg } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { sendNow, unsend } from "../data/waiting.ts";
import { useT } from "../i18n/index.ts";

const seenWaiting = new Set<string>();

/** Whether the agent has taken a message the owner saw waiting: it carries a mark saying so, "Now". */
export function useTaken(message: Msg): boolean {
  if (message.waiting) seenWaiting.add(message.id);
  return !message.waiting && seenWaiting.has(message.id);
}

/** Under a message the agent has taken while it worked: two ticks and "Now", as a chat app marks a delivered one. */
export function TakenMark() {
  const t = useT();
  return (
    <span className="waiting__taken">
      <Icons.CheckCheck size={12} />
      {t("waiting.taken")}
    </span>
  );
}

/** Under a message the agent reads at its next step: that it waits, and how to have it read now or take it back. */
export function WaitingMarks({ message, sending }: { message: Msg; sending: boolean }) {
  const t = useT();
  return (
    <span className="waiting__marks">
      <span className="waiting__taken">
        <Icons.Clock size={12} />
        {t("waiting.pending")}
      </span>
      <SendNowButton message={message} />
      {!sending && <UnsendButton message={message} />}
    </span>
  );
}

/** The agent takes this message at once: the step it is on stops. */
export function SendNowButton({ message, iconOnly = false }: { message: Msg; iconOnly?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await sendNow(message);
    setBusy(false);
  };
  if (iconOnly)
    return (
      <IconButton
        size="sm"
        className="waiting__act"
        label={t("waiting.sendNow")}
        icon={<Icons.Zap size={13} />}
        disabled={busy}
        onClick={() => void go()}
      />
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      className="waiting__now"
      leadingIcon={<Icons.Zap size={12} />}
      loading={busy}
      onClick={() => void go()}
    >
      {t("waiting.sendNow")}
    </Button>
  );
}

/** Takes the message back before the agent reads it. */
function UnsendButton({ message }: { message: Msg }) {
  const t = useT();
  return (
    <IconButton
      size="sm"
      className="waiting__act"
      label={t("waiting.remove")}
      icon={<Icons.Trash2 size={13} />}
      onClick={() => void unsend(message)}
    />
  );
}
