import type { Agent, CatalogEngine, Run, Thread } from "@apx/protocol";
import { Composer, EngineIcon, IconButton, Icons, Menu, SegmentedControl, withMentions } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngineLabel } from "../../common/useEngineLabel.ts";
import { ModelChoicePicker } from "../../config/models/ModelPickers.tsx";
import { cancel, loadThread, makeChat, send } from "../../data/actions.ts";
import { sendDirect } from "../../data/channels.ts";
import { setThreadModel } from "../../data/composer.ts";
import { draftOf, keepDraft } from "../../data/drafts.ts";
import { isPending } from "../../data/identity.ts";
import { choiceLabel, effectiveChoice, splitRef, useModels } from "../../data/models.ts";
import { isNewChat } from "../../data/newChat.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { AttachChips } from "./AttachChips.tsx";
import { ContextChip } from "./ContextChip.tsx";
import { contextOf, spentOf } from "./context.ts";
import { useSlashMenu } from "./SlashMenu.tsx";
import { useAttachments } from "./useAttachments.ts";
import { useDictation } from "./useDictation.ts";
import { useFileDrop } from "./useFileDrop.ts";
import { VoiceRecording } from "./VoiceRecording.tsx";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/**
 * The chat's composer, left to right: + (file, image), the chat's model, then how full the chat is (opens Usage),
 * the mic (records audio with its words) and send. While the agent works, Enter interrupts it and Ctrl/⌘+Enter queues.
 * A field starting with "/" opens the command and skill menu.
 * Files also arrive dragged or pasted. What is typed stays as the chat's draft until it is sent.
 * A new chat (see newChat.ts) is made with its first message; `onMade` then opens it (by default, where it was).
 * In a channel's room the owner picks, as in a contact's chat: tell the agent what to post there, or write it as is.
 */
export function ChatComposer({
  thread,
  agent,
  onMade = (id) => go.madeThread(thread.id, id),
}: {
  thread: Thread;
  agent: Agent | undefined;
  onMade?: (id: string) => void;
}) {
  const t = useT();
  const offline = useData((s) => s.connection === "offline");
  const engine = useEngineLabel(thread.engine);
  const runsById = useData((s) => s.runs);
  const [text, setTextNow] = useState(() => draftOf(thread.id));
  useEffect(() => keepDraft(thread.id, text), [thread.id, text]);
  // Typed text is kept at once too: a pick that also leaves the chat (/new) unmounts it before the effect runs.
  const setText = (v: string | ((cur: string) => string)) => {
    if (typeof v === "string") keepDraft(thread.id, v);
    setTextNow(v);
  };
  const fresh = isNewChat(thread.id);
  // Files and voice notes of a new chat are uploaded to no chat yet; they go with its first message.
  const made = fresh ? undefined : thread.id;
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const appendWords = (words: string) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${words}` : words));
  const att = useAttachments(made, appendWords);
  const box = useRef<HTMLDivElement>(null);
  const mic = useDictation(made, (audio, words) => {
    att.restore([audio]);
    if (words) appendWords(words);
  });
  const micBusy = mic.state === "recording" || mic.state === "starting" || mic.state === "transcribing";
  const over = useFileDrop(box, (files) => {
    if (!micBusy) att.add(files);
  });
  // A queued delegation is work the owner can stop too.
  const busy = isPending(thread.state);
  const room = thread.channel && !thread.channel.person_id ? thread.title : undefined;
  const [direct, setDirect] = useState(false);
  const agentName = agent?.name ?? t("composer.yourAgent");
  const slash = useSlashMenu({ thread, agent, text, setText, busy });
  const runs = useMemo(
    () =>
      Object.values(runsById)
        .filter((r: Run) => r.thread_id === thread.id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [runsById, thread.id],
  );

  // A new chat is made once: what is sent while it is being made waits.
  const making = useRef(false);
  const created = useRef<Thread | undefined>(undefined);
  const submit = (value: string, { queue }: { queue: boolean }) => {
    if (micBusy || making.current) return;
    if (att.uploading) return notify(t("composer.stillUploading"), "info");
    const attachments = att.take();
    const words = value.trim() || (attachments.length ? t("composer.attachedOnly") : "");
    if (!words) return;
    if (room && direct) {
      att.restore(attachments);
      if (attachments.length) return notify(t("ch.room.noFiles", { agent: agentName }), "info");
      setText("");
      void sendDirect(thread.id, words).then((ok) => (ok ? loadThread(thread.id) : setText((cur) => cur || value)));
      return;
    }
    setText("");
    // A send that fails gives the words and the files back, so nothing the owner wrote is lost.
    const giveBack = () => {
      setText((cur) => cur || value);
      att.restore(attachments);
    };
    if (!fresh) return void send(thread.id, words, { attachments, queue }).catch(giveBack);
    making.current = true;
    void (async () => {
      try {
        // Keep the created chat on failure: retry sends the restored files without making another chat.
        const chat = created.current ?? (await makeChat(thread.id));
        created.current = chat;
        await send(chat.id, words, { attachments, queue });
        onMade(chat.id);
      } catch {
        giveBack();
      } finally {
        making.current = false;
      }
    })();
  };
  const pick = (input: HTMLInputElement | null) => input?.click();

  return (
    <div
      ref={box}
      className={`chat__composer${over ? " is-dropping" : ""}${mic.state === "recording" ? " is-recording" : ""}`}
    >
      <input
        ref={files}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (!micBusy) att.add(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={images}
        type="file"
        accept={IMAGE_TYPES}
        multiple
        hidden
        onChange={(e) => {
          if (!micBusy) att.add(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
        }}
      />
      <Composer
        highlight={withMentions}
        placeholder={
          offline
            ? t("composer.offline")
            : room
              ? t(direct ? "ch.room.writeMe" : "ch.room.writeAgent", { agent: agentName, room })
              : t("composer.placeholder", { name: engine ?? agentName })
        }
        labels={{ stop: t("composer.stop"), send: t("composer.send") }}
        sendHint={t("composer.sendHint")}
        value={text}
        onValueChange={setText}
        ready={att.ready && !att.uploading}
        disabled={offline || micBusy}
        busy={busy && !text.trim() && !att.ready}
        onStop={() => void cancel(thread.id)}
        onSubmit={submit}
        header={
          micBusy || att.chips.length ? (
            <>
              <VoiceRecording state={mic.state} levels={mic.levels} seconds={mic.seconds} heard={mic.heard} />
              {att.chips.length > 0 && <AttachChips chips={att.chips} onRemove={att.remove} />}
            </>
          ) : undefined
        }
        popup={slash.popup}
        onInputKeyDown={slash.onKey}
        inputAria={slash.aria}
        toolbar={
          <>
            <Menu
              align="start"
              side="top"
              items={[
                {
                  label: t("composer.attachFile"),
                  disabled: offline || micBusy,
                  icon: <Icons.Paperclip size={14} />,
                  onSelect: () => pick(files.current),
                },
                {
                  label: t("composer.attachImage"),
                  disabled: offline || micBusy,
                  icon: <Icons.Image size={14} />,
                  onSelect: () => pick(images.current),
                },
              ]}
              trigger={<IconButton size="sm" label={t("composer.attach")} icon={<Icons.Plus size={16} />} />}
            />
            {room && (
              <SegmentedControl
                size="sm"
                label={t("ch.room.who")}
                value={direct ? "me" : "agent"}
                onValueChange={(v) => setDirect(v === "me")}
                options={[
                  { value: "agent", label: t("ch.room.agentPosts", { agent: agentName }) },
                  { value: "me", label: t("ch.iWrite") },
                ]}
              />
            )}
            {!direct && <ChatModel thread={thread} agent={agent} />}
            <span className="composer__spacer" />
            <ContextChip context={contextOf(runs)} spent={spentOf(runs)} />
            {mic.state !== "unsupported" && (
              <IconButton
                size="sm"
                className={`composer__mic is-${mic.state}`}
                label={mic.state === "recording" ? t("composer.dictateStop") : t("composer.dictate")}
                icon={
                  mic.state === "transcribing" ? (
                    <Icons.LoaderCircle size={14} />
                  ) : mic.state === "recording" ? (
                    <Icons.Square size={12} fill="currentColor" />
                  ) : (
                    <Icons.Mic size={14} />
                  )
                }
                disabled={
                  offline ||
                  mic.state === "transcribing" ||
                  mic.state === "starting" ||
                  (mic.state === "idle" && att.full)
                }
                onClick={mic.toggle}
              />
            )}
          </>
        }
      />
      {room && (
        <p className="chat__composer-hint">
          {t(direct ? "ch.room.hint.me" : "ch.room.hint.agent", { agent: agentName, room })}
        </p>
      )}
    </div>
  );
}

/** The chat's own model, tried before the agent's; "the agent's model" goes back to it. */
function ChatModel({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const config = useModels((s) => s.config);
  const own = thread.model_choice;
  const effective = effectiveChoice(own, agent?.model_choice, config);
  const text = choiceLabel(effective, catalog, config);
  return (
    <ModelChoicePicker
      label={t("composer.modelOfChat")}
      value={own ?? null}
      {...(agent?.model_choice ? { inherited: agent.model_choice } : {})}
      text={text}
      align="start"
      className={`composer__model${own ? " is-own" : ""}`}
      icon={
        effective?.model ? (
          <EngineIcon engine={splitRef(effective.model).engine} size={12} />
        ) : (
          <Icons.Sparkles size={12} />
        )
      }
      none={{
        title: t("composer.agentModel"),
        desc: t("composer.agentModelDesc", { name: agent?.name ?? t("composer.yourAgent") }),
        action: t("composer.backToAgentModel"),
      }}
      // A CLI's own session offers that CLI's models; any other chat, the model APIs agents run on.
      {...(thread.engine ? { only: (e: CatalogEngine) => e.id === thread.engine } : {})}
      onChange={(choice) => void setThreadModel(thread.id, choice)}
    />
  );
}
