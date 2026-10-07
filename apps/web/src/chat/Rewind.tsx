// Editing one of the owner's messages and asking again for an answer: the chat goes back to that point and sends
// again, so what came after it is removed (asked first when there is any).
import type { Message as Msg, Thread } from "@apx/protocol";
import { Button, Dialog, IconButton, Icons, Message, Textarea } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { isWorking } from "../data/identity.ts";
import { rewindThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { MessageActions } from "./MessageActions.tsx";

/** Whether this chat can go back: nothing running, not a channel's chat (delivered), not an engine session. */
export function canRewind(thread: Thread): boolean {
  return (
    !thread.channel &&
    !thread.engine &&
    !isWorking(thread.state) &&
    thread.state !== "input-required" &&
    thread.kind !== "a2a"
  );
}

/** Messages past the answer to `from`: they go too when the chat goes back to it (its own answer is replaced). */
function later(messages: Msg[], from: Msg): number {
  const rest = messages.filter((m) => m.seq > from.seq);
  const next = rest.findIndex((m) => m.author.kind === "user");
  return next < 0 ? 0 : rest.length - next;
}

/** The owner's message that asked for an answer: the closest one at or before it. */
const askedBy = (messages: Msg[], answer: Msg) =>
  messages.findLast((m) => m.seq <= answer.seq && m.author.kind === "user");

/** Asks before removing later messages; with none to remove it goes straight on. */
function useConfirm() {
  const [pending, setPending] = useState<{ count: number; go: () => Promise<boolean> }>();
  const [busy, setBusy] = useState(false);
  const ask = (count: number, go: () => Promise<boolean>) => (count ? setPending({ count, go }) : void go());
  const t = useT();
  const dialog = pending && (
    <Dialog
      open
      title={t("rewind.confirmTitle")}
      description={t("rewind.confirmBody", { count: pending.count })}
      onOpenChange={(o) => !o && !busy && setPending(undefined)}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => setPending(undefined)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await pending.go();
              setBusy(false);
              setPending(undefined);
            }}
          >
            {t("rewind.confirm")}
          </Button>
        </>
      }
    />
  );
  return { ask, dialog };
}

/** The owner's message: with its controls on hover, a pencil that turns it into an editor that sends it again. */
export function UserMessage({
  thread,
  message,
  messages,
  text,
  reactions,
  children,
}: {
  thread: Thread;
  message: Msg;
  messages: Msg[];
  text: string;
  /** Emoji put on it on a channel (the agent's reaction to the owner's words). */
  reactions?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string>();
  const { ask, dialog } = useConfirm();
  const pending = message.id.startsWith("local_");
  const send = () => {
    const next = draft?.trim();
    if (!next || next === text.trim()) return setDraft(undefined);
    ask(later(messages, message), async () => {
      const ok = await rewindThread(thread.id, message.id, next);
      if (ok) setDraft(undefined);
      return ok;
    });
  };
  return (
    <Message
      from="user"
      // Editing, the field takes the bubble's place: an input on the ink bubble would read as part of it.
      variant={draft === undefined ? "bubble" : "bare"}
      className={cx(pending && "is-pending", draft !== undefined && "is-editing")}
      reactions={draft === undefined ? reactions : undefined}
      actions={
        draft === undefined ? (
          <MessageActions thread={thread} message={message} text={text} speechKey={message.id} speak={false}>
            {!pending && canRewind(thread) && (
              <IconButton
                size="sm"
                label={t("rewind.edit")}
                icon={<Icons.Pencil size={13} />}
                onClick={() => setDraft(text)}
              />
            )}
          </MessageActions>
        ) : undefined
      }
    >
      {draft === undefined ? (
        children
      ) : (
        <div className="rewind__edit">
          <Textarea
            autoFocus
            rows={Math.min(10, Math.max(2, draft.split("\n").length))}
            value={draft}
            aria-label={t("rewind.edit")}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(undefined);
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="rewind__bar">
            <Button size="sm" variant="secondary" onClick={() => setDraft(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" disabled={!draft.trim()} onClick={send}>
              {t("rewind.send")}
            </Button>
          </div>
        </div>
      )}
      {dialog}
    </Message>
  );
}

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ") || undefined;

/** "Ask again" under an agent's answer: back to the owner's message that asked for it, sent again as it was. */
export function Regenerate({ thread, message, messages }: { thread: Thread; message: Msg; messages: Msg[] }) {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const from = askedBy(messages, message);
  if (!from || !canRewind(thread)) return null;
  return (
    <>
      <IconButton
        size="sm"
        label={t("rewind.regenerate")}
        icon={<Icons.RefreshCw size={13} />}
        onClick={() => ask(later(messages, from), () => rewindThread(thread.id, message.id))}
      />
      {dialog}
    </>
  );
}
