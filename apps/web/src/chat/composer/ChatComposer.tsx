import type { Agent, CatalogEngine, Run, Thread } from "@apx/protocol";
import { Composer, EngineIcon, IconButton, Icons, Menu } from "@apx/ui";
import { useMemo, useRef, useState } from "react";
import { useEngineLabel } from "../../common/useEngineLabel.ts";
import { ModelChoicePicker } from "../../config/models/ModelPickers.tsx";
import { cancel, send } from "../../data/actions.ts";
import { setThreadModel } from "../../data/composer.ts";
import { isWorking } from "../../data/identity.ts";
import { choiceLabel, splitRef, useModels } from "../../data/models.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { takeDraft } from "../../data/threadAdmin.ts";
import { useT } from "../../i18n/index.ts";
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
 * Files also arrive dragged or pasted.
 */
export function ChatComposer({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const offline = useData((s) => s.connection === "offline");
  const engine = useEngineLabel(thread.engine);
  const runsById = useData((s) => s.runs);
  const [text, setText] = useState(() => takeDraft(thread.id));
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const appendWords = (words: string) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${words}` : words));
  const att = useAttachments(thread.id, appendWords);
  const box = useRef<HTMLDivElement>(null);
  const mic = useDictation(thread.id, (audio, words) => {
    att.restore([audio]);
    if (words) appendWords(words);
  });
  const micBusy = mic.state === "recording" || mic.state === "starting" || mic.state === "transcribing";
  const over = useFileDrop(box, (files) => {
    if (!micBusy) att.add(files);
  });
  const busy = isWorking(thread.state);
  const slash = useSlashMenu({ thread, agent, text, setText, busy });
  const runs = useMemo(
    () =>
      Object.values(runsById)
        .filter((r: Run) => r.thread_id === thread.id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [runsById, thread.id],
  );

  const submit = (value: string, { queue }: { queue: boolean }) => {
    if (micBusy) return;
    if (att.uploading) return notify(t("composer.stillUploading"), "info");
    const attachments = att.take();
    const words = value.trim() || (attachments.length ? t("composer.attachedOnly") : "");
    if (!words) return;
    setText("");
    // A send that fails gives the words and the files back, so nothing the owner wrote is lost.
    send(thread.id, words, { attachments, queue }).catch(() => {
      setText((cur) => cur || value);
      att.restore(attachments);
    });
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
        placeholder={
          offline
            ? t("composer.offline")
            : t("composer.placeholder", { name: engine ?? agent?.name ?? t("composer.yourAgent") })
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
              <VoiceRecording state={mic.state} levels={mic.levels} seconds={mic.seconds} />
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
            <ChatModel thread={thread} agent={agent} />
            <span className="composer__spacer" />
            <ContextChip context={contextOf(runs)} spent={spentOf(runs)} />
            {mic.state !== "unsupported" && (
              <IconButton
                size="sm"
                className={`composer__mic is-${mic.state}`}
                label={mic.state === "recording" ? t("composer.dictateStop") : t("composer.dictate")}
                icon={mic.state === "transcribing" ? <Icons.LoaderCircle size={14} /> : <Icons.Mic size={14} />}
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
    </div>
  );
}

/** The chat's own model, tried before the agent's; "the agent's model" goes back to it. */
function ChatModel({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const own = thread.model_choice;
  const effective = own ?? agent?.model_choice;
  const text = effective?.model ? choiceLabel(effective, catalog) : t("composer.auto");
  return (
    <ModelChoicePicker
      label={t("composer.modelOfChat")}
      value={own ?? null}
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
