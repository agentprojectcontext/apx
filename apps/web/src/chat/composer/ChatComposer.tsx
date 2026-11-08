import type { Agent, CatalogEngine, Run, Thread } from "@apx/protocol";
import { Composer, EngineIcon, IconButton, Icons, SegmentedControl } from "@apx/ui";
import { type KeyboardEvent, Suspense, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MOD } from "../../common/modKey.ts";
import { useEngineLabel } from "../../common/useEngineLabel.ts";
import { ModelChoicePicker } from "../../config/models/ModelPickers.tsx";
import { cancel, loadThread, makeChat, send } from "../../data/actions.ts";
import { openAside } from "../../data/aside.ts";
import { sendDirect } from "../../data/channels.ts";
import { setThreadModel, transcribe } from "../../data/composer.ts";
import { draftOf, keepDraft, subscribeDrafts } from "../../data/drafts.ts";
import { isPending, isWorking } from "../../data/identity.ts";
import { choiceLabel, effectiveChoice, effortLabel, modelOf, splitRef, useModels } from "../../data/models.ts";
import { isNewChat } from "../../data/newChat.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { AttachChips } from "../../lazy.ts";
import { go } from "../../shell/nav.ts";
import { AsidePanel, useAsideOpen } from "./AsidePanel.tsx";
import { ContextChip } from "./ContextChip.tsx";
import { ContextChips } from "./ContextChips.tsx";
import { contextOf, contextRunOf, spentOf, usageStamp } from "./context.ts";
import { addRef, removeRef, restoreRefs, takeRefs, useContextRefs, withRefs } from "./contextRefs.ts";
import { composerMarks } from "./marks.tsx";
import { PlusMenu } from "./PlusMenu.tsx";
import { useSlashMenu } from "./SlashMenu.tsx";
import { useThreadUsage } from "./usage.ts";
import { useAttachments } from "./useAttachments.ts";
import { useDictation } from "./useDictation.ts";
import { useFileDrop } from "./useFileDrop.ts";
import { MicWave, VoiceRecording } from "./VoiceRecording.tsx";

/**
 * The chat's composer, one line: + (files, a folder, audio, a skill, connectors, commands), the field, the mic
 * (dictates words into the field) and send; under it, the chat's model and how full the chat is. While the agent
 * works, Enter sends (its next step reads it) and
 * Ctrl/⌘+Enter puts it in line for when it finishes (DECISIONS.md#d-186).
 * A field starting with "/" opens the command and skill menu.
 * Files also arrive dragged or pasted. What is typed stays as the chat's draft until it is sent.
 * A new chat (see newChat.ts) is made with its first message; `onMade` then opens it (by default, where it was).
 * In a channel's room the owner picks, as in a contact's chat: tell the agent what to post there, or write it as is.
 */
export function ChatComposer({
  thread,
  agent,
  onMade = (id) => go.madeThread(thread.id, id),
  onNew = go.thread,
  prepare,
  offlineHint = true,
  placeholder,
}: {
  thread: Thread;
  agent: Agent | undefined;
  onMade?: (id: string) => void;
  /** Embedded chats handle /new without navigating the full panel. */
  onNew?: (id: string) => void;
  /** Hide the repeated placeholder notice when the surrounding screen already explains the offline state. */
  offlineHint?: boolean;
  /** Runs before each message goes: the words to send (with what the screen adds), or null to keep them unsent. */
  prepare?: (words: string) => Promise<string | null>;
  /** The field's hint when the screen says more than "Write to <agent>" (a routine's chat). */
  placeholder?: string;
}) {
  const t = useT();
  const offline = useData((s) => s.connection === "offline");
  const engine = useEngineLabel(thread.engine);
  const runsById = useData((s) => s.runs);
  const text = useSyncExternalStore(subscribeDrafts, () => draftOf(thread.id));
  const setText = (v: string | ((cur: string) => string)) => {
    keepDraft(thread.id, typeof v === "string" ? v : v(draftOf(thread.id)));
  };
  const fresh = isNewChat(thread.id);
  // Files and voice notes of a new chat are uploaded to no chat yet; they go with its first message.
  const made = fresh ? undefined : thread.id;
  const files = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const appendWords = (words: string) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${words}` : words));
  const att = useAttachments(thread.id, made);
  const box = useRef<HTMLDivElement>(null);
  const mic = useDictation(made, appendWords);
  const micBusy = mic.state === "recording" || mic.state === "starting" || mic.state === "transcribing";
  // The one shortcut worth knowing while the agent works, under the box; not while the mic has the field.
  const queueHint = isWorking(thread.state) && !micBusy ? t("composer.queueHint", { mod: MOD }) : undefined;
  const over = useFileDrop(box, (files) => {
    if (!micBusy) att.add(files);
  });
  // A queued delegation is work the owner can stop too.
  const busy = isPending(thread.state);
  const room = thread.channel && !thread.channel.person_id ? thread.title : undefined;
  const [direct, setDirect] = useState(false);
  const aside = useAsideOpen(thread.id);
  const agentName = agent?.name ?? t("composer.yourAgent");
  const slash = useSlashMenu({ thread, agent, text, setText, busy, onNew });
  const runs = useMemo(
    () =>
      Object.values(runsById)
        .filter((r: Run) => r.thread_id === thread.id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [runsById, thread.id],
  );
  const usage = useThreadUsage(fresh ? undefined : thread.id, usageStamp(runs));
  const refs = useContextRefs(thread.id);
  // Audio files being turned into words for the field (not attached).
  const [hearing, setHearing] = useState(0);
  const transcribeAudio = (picked: Iterable<File>) => {
    for (const file of picked) {
      setHearing((n) => n + 1);
      void transcribe(file, made)
        .then((words) => words && appendWords(words))
        .finally(() => setHearing((n) => n - 1));
    }
  };

  // A new chat is made once: what is sent while it is being made waits.
  const making = useRef(false);
  const created = useRef<Thread | undefined>(undefined);
  const submit = (value: string, { queue }: { queue: boolean }) => {
    if (micBusy || making.current) return;
    // A command picked from the menu waits in the field: sent, it runs instead of going as words.
    const command = att.ready || refs.length ? undefined : slash.command(value);
    if (command) {
      setText("");
      return command();
    }
    if (att.uploading) return notify(t("composer.stillUploading"), "info");
    if (room && direct && refs.length) return notify(t("ch.room.noFiles", { agent: agentName }), "info");
    const attachments = att.take();
    const added = takeRefs(thread.id);
    const words = withRefs(value.trim() || (attachments.length ? t("composer.attachedOnly") : ""), added);
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
      if (!att.active()) return;
      setText((cur) => (cur ? `${value}\n\n${cur}` : value));
      att.restore(attachments);
      restoreRefs(thread.id, added);
    };
    const deliver = (said: string) => {
      if (!fresh) return void send(thread.id, said, { attachments, queue }).catch(giveBack);
      making.current = true;
      void (async () => {
        try {
          // Keep the created chat on failure: retry sends the restored files without making another chat.
          const chat = created.current ?? (await makeChat(thread.id));
          created.current = chat;
          await send(chat.id, said, { attachments, queue });
          onMade(chat.id);
        } catch {
          giveBack();
        } finally {
          making.current = false;
        }
      })();
    };
    if (!prepare) return deliver(words);
    void prepare(words).then((said) => (said ? deliver(said) : giveBack()), giveBack);
  };
  const pick = (input: HTMLInputElement | null) => input?.click();
  const field = useRef<HTMLTextAreaElement>(null);
  // After a pick in the + menu (which hands the focus back to +), typing goes on in the field, at its end.
  const backToField = () =>
    window.setTimeout(() => {
      const el = field.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  const lastModel = runs.find((r) => r.model)?.model;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.onKey(e)) return true;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      if (!offline && !micBusy) pick(files.current);
      return true;
    }
    return false;
  };

  return (
    <div
      ref={box}
      className={`chat__composer${over ? " is-dropping" : ""}${mic.state === "recording" ? " is-recording" : ""}`}
    >
      {aside && <AsidePanel key={thread.id} thread={thread.id} agent={agentName} />}
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
        ref={audio}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          if (!micBusy) transcribeAudio(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
        }}
      />
      <Composer
        className="composer--slim"
        highlight={composerMarks}
        placeholder={
          offline && offlineHint
            ? t("composer.offline")
            : room
              ? t(direct ? "ch.room.writeMe" : "ch.room.writeAgent", { agent: agentName, room })
              : (placeholder ?? t("composer.placeholder", { name: engine ?? agentName }))
        }
        labels={{ stop: t("composer.stop"), send: t("composer.send") }}
        // Claude Code takes words mid-turn as our own loop does; other engines stop and read them (DECISIONS.md#d-196).
        sendHint={t(thread.engine && thread.engine !== "claude" ? "composer.sendHintStop" : "composer.sendHint")}
        value={text}
        onValueChange={setText}
        // Files or context alone can go: the agent reads them.
        ready={(att.ready && !att.uploading) || refs.length > 0}
        disabled={offline || micBusy}
        busy={busy && !text.trim() && !att.ready && !refs.length}
        // While the mic records, its own button is the one stop; send comes back with the words.
        sendHidden={micBusy}
        onStop={() => void cancel(thread.id)}
        onSubmit={submit}
        header={
          micBusy || hearing > 0 || att.chips.length || refs.length ? (
            <>
              <VoiceRecording
                state={micBusy ? mic.state : hearing > 0 ? "transcribing" : "idle"}
                seconds={mic.seconds}
                heard={mic.heard}
              />
              {refs.length > 0 && <ContextChips refs={refs} onRemove={(r) => removeRef(thread.id, r)} />}
              {att.chips.length > 0 && (
                <Suspense fallback={<div role="status">{att.chips.map((chip) => chip.name).join(", ")}</div>}>
                  <AttachChips chips={att.chips} onRemove={att.remove} />
                </Suspense>
              )}
            </>
          ) : undefined
        }
        popup={slash.popup}
        onInputKeyDown={onKey}
        inputRef={field}
        inputAria={slash.aria}
        toolbar={
          <>
            <PlusMenu
              thread={thread}
              made={made}
              disabled={offline || micBusy}
              direct={Boolean(thread.engine)}
              connectors={slash.connectors}
              onOpen={slash.loadConnectors}
              onFiles={() => pick(files.current)}
              onAudio={() => pick(audio.current)}
              onSkill={() => {
                slash.skills();
                backToField();
              }}
              onConnector={(name) => {
                slash.connector(name);
                backToField();
              }}
              onCommands={() => {
                slash.commands();
                backToField();
              }}
              onContext={(ref) => {
                addRef(thread.id, ref);
                backToField();
              }}
              onAside={fresh || thread.engine ? undefined : () => openAside(thread.id)}
            />
            {mic.state !== "unsupported" && (
              <span className="composer__voice">
                {mic.state === "recording" && <MicWave levels={mic.levels} />}
                <IconButton
                  size="md"
                  shape="circle"
                  className={`composer__mic is-${mic.state}`}
                  label={mic.state === "recording" ? t("composer.dictateStop") : t("composer.dictate")}
                  icon={
                    mic.state === "transcribing" ? (
                      <Icons.LoaderCircle size={16} />
                    ) : mic.state === "recording" ? (
                      <Icons.Square size={12} fill="currentColor" />
                    ) : (
                      <Icons.Mic size={16} />
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
              </span>
            )}
          </>
        }
      />
      <div className="chat__composer-foot">
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
        {room && (
          <p className="chat__composer-hint">
            {t(direct ? "ch.room.hint.me" : "ch.room.hint.agent", { agent: agentName, room })}
          </p>
        )}
        {queueHint && <p className="chat__composer-hint is-queue">{queueHint}</p>}
        <span className="composer__spacer" />
        {!direct && <ChatModel thread={thread} agent={agent} />}
        <ContextChip
          context={contextOf(runs)}
          spent={spentOf(usage?.totals)}
          run={contextRunOf(runs)}
          thread={made}
          engine={Boolean(thread.engine)}
          totals={usage?.totals}
          model={lastModel}
          loading={!fresh && usage === undefined && !contextOf(runs)}
        />
      </div>
    </div>
  );
}

/** The chat's own model, tried before the agent's; "the agent's model" goes back to it. */
function ChatModel({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const offline = useData((s) => s.connection !== "online");
  const catalog = useModels((s) => s.catalog);
  const config = useModels((s) => s.config);
  const own = thread.model_choice;
  const effective = effectiveChoice(own, agent?.model_choice, config);
  // The model by its own name (its provider's mark beside it) and how hard it thinks; the router alone by its route.
  const ref = effective.model ? splitRef(effective.model) : undefined;
  const text = ref
    ? (ref.model ?? catalog.find((e) => e.id === ref.engine)?.label ?? ref.engine)
    : choiceLabel(effective, catalog, config);
  const effort = effective.model && (ref?.effort ?? modelOf(effective.model, catalog)?.default_effort);
  return (
    <ModelChoicePicker
      label={t("composer.modelOfChat")}
      value={own ?? null}
      {...(agent?.model_choice ? { inherited: agent.model_choice } : {})}
      text={offline ? t("models.unavailable") : text}
      {...(effort && !offline ? { extra: <span className="composer__effort"> {effortLabel(effort)}</span> } : {})}
      slim
      disabled={offline}
      align="end"
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
