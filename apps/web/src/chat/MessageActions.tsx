// The controls under one bubble: copy its words, quote or answer it (in a task), fork the chat from it, read it aloud.
import type { Message as Msg, Thread } from "@apx/protocol";
import { IconButton, Icons, Spinner } from "@apx/ui";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { notify } from "../data/notices.ts";
import { speak, stopSpeaking, useSpeaking, useSpeechReady } from "../data/speech.ts";
import { forkThread } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { QuoteContext } from "./quote.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An engine session keeps its own history, and a chat of several agents has no one agent to carry on. */
const canFork = (thread: Thread) => !thread.engine && thread.agent_ids.length === 1;

export function MessageActions({
  thread,
  message,
  text,
  speechKey,
  speak = true,
  children,
}: {
  thread: Thread;
  message: Msg;
  /** What this bubble says (one bubble of an answer, not the whole answer). */
  text: string;
  /** Tells this bubble's reading apart from the other bubbles of the same message. */
  speechKey: string;
  /** Read aloud: an agent's or a contact's words, not the owner's own. */
  speak?: boolean;
  /** Controls of its own kind (edit, ask again), after these. */
  children?: ReactNode;
}) {
  const t = useT();
  const quote = useContext(QuoteContext);
  const pending = message.id.startsWith("local_");
  return (
    <>
      {text.trim() && <CopyButton text={text} />}
      {quote && !pending && text.trim() && (
        <>
          <IconButton
            size="sm"
            label={t("msg.quote")}
            icon={<Icons.Quote size={13} />}
            onClick={() => quote(message, text, false)}
          />
          {message.author.kind === "agent" && (
            <IconButton
              size="sm"
              label={t("msg.reply")}
              icon={<Icons.Reply size={13} />}
              onClick={() => quote(message, text, true)}
            />
          )}
        </>
      )}
      {!pending && canFork(thread) && (
        <IconButton
          size="sm"
          label={t("msg.fork")}
          icon={<Icons.GitBranch size={13} />}
          onClick={async () => {
            const id = await forkThread(thread.id, message.id, t("msg.forkTitle", { title: thread.title }));
            if (id) go.thread(id);
          }}
        />
      )}
      {speak && text.trim() && <ReadAloud text={text} speechKey={speechKey} />}
      {children}
      <time
        className="msgactions__when"
        dateTime={message.created_at}
        title={new Date(message.created_at).toLocaleString()}
      >
        {shortWhen(message.created_at)}
      </time>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <IconButton
      size="sm"
      label={copied ? t("msg.copied") : t("msg.copy")}
      icon={copied ? <Icons.Check size={13} /> : <Icons.Copy size={13} />}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          (e) => notify(errText(e)),
        )
      }
    />
  );
}

/** With no voice set up it stays, crossed out, and says where to add one. */
function ReadAloud({ text, speechKey }: { text: string; speechKey: string }) {
  const t = useT();
  const ready = useSpeechReady();
  const state = useSpeaking(speechKey);
  if (ready === undefined) return null;
  if (!ready)
    return (
      <IconButton
        size="sm"
        className="msgactions__off"
        aria-disabled
        label={t("msg.readAloud")}
        tooltip={t("msg.noVoice")}
        icon={<Icons.VolumeOff size={13} />}
      />
    );
  return (
    <IconButton
      size="sm"
      active={state !== undefined}
      label={state ? t("msg.stopReading") : t("msg.readAloud")}
      icon={
        state === "loading" ? <Spinner size={13} /> : state ? <Icons.Square size={11} /> : <Icons.Volume2 size={13} />
      }
      onClick={() =>
        state
          ? stopSpeaking()
          : speak(speechKey, text).catch((e) => notify(t("error.readAloud", { error: errText(e) })))
      }
    />
  );
}
