import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { draftOf, keepDraft } from "./chat/drafts";
import { latestPlan } from "./chat/media";
import { type CatalogEngine, choiceLabel, type ModelChoice } from "./chat/models";
import { isNewChat } from "./chat/newChat";
import { showsStartHint, type TranscriptRow, usageText, withDays } from "./chat/transcript";
import { useAttachments } from "./chat/useAttachments";
import { useVoiceNote } from "./chat/useVoiceNote";
import { inLine, outOfLine } from "./chat/waiting";
import type { Creds } from "./creds";
import { dayLabel } from "./format";
import { channelIdentity, engineName, isWorking, routineName, threadContext } from "./hooks/chatSelectors";
import { continueSession, sessionState } from "./hooks/continueSession";
import { useThread } from "./hooks/useThread";
import type { Thread, Workspace } from "./hooks/useWorkspace";
import { t } from "./i18n";
import type { Message, RoutineRun } from "./protocol";
import { BrowserConsents } from "./ui/BrowserConsents";
import { ChatComposer } from "./ui/ChatComposer";
import { ChatMenu } from "./ui/ChatMenu";
import { ChatMessage } from "./ui/ChatMessage";
import { ComputerProgress } from "./ui/chat/ComputerProgress";
import { QueueTray } from "./ui/chat/QueueTray";
import { RoutineRunsSheet, runWhen } from "./ui/chat/RoutineRunsSheet";
import { EngineIcon } from "./ui/EngineIcon";
import { Icon } from "./ui/Icon";
import { ActivityPill, AgentAvatar, BottomSheet, EmptyState, IconButton, ListRow, Spinner } from "./ui/kit";
import { ModelSheet } from "./ui/ModelSheet";
import { MediaClient } from "./ui/media/context";
import { PersonAvatar } from "./ui/PersonAvatar";
import { makeStyles, useTheme } from "./ui/theme";

export function ChatScreen({
  creds,
  onUnpair,
  onApps,
  base,
  focus,
  data,
  onBack,
  onSwitch,
  onNewChat,
  make,
  onMade,
  onOpenThread,
  routineRuns,
  onOpenRun,
  onRoutine,
}: {
  creds: Creds;
  onUnpair: () => void;
  onApps: () => void;
  /** The chat as the list knows it, until the live one loads. */
  base: Thread;
  /** A message to scroll to and light for a moment once it is loaded (a shared file's). */
  focus?: string;
  data: Workspace;
  onBack: () => void;
  onSwitch: () => void;
  onNewChat: () => void;
  /** Makes a new chat (see chat/newChat.ts) in the core, as its first message goes. */
  make: (base: Thread) => Promise<Thread>;
  /** Opens the chat a new one became. */
  onMade: (thread: Thread) => void;
  /** Opens another chat by id: a delegation's or a consult's, from its card. */
  onOpenThread?: (id: string) => void;
  /** A routine's runs, newest first, for the picker of a routine's chat. */
  routineRuns?: (routineId: string, limit?: number) => Promise<RoutineRun[]>;
  /** Shows another run of the same routine in this chat's place. */
  onOpenRun?: (id: string) => void;
  /** Opens a routine's page. */
  onRoutine?: (routineId: string) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const live = useThread(creds, base.id, onUnpair);
  const insets = useSafeAreaInsets();
  const thread = (live.thread as Thread | undefined) ?? base;
  const agent = data.agents.find((item) => item.id === thread.agent_ids[0]);
  const contact = channelIdentity(thread, data);
  const name = thread.engine ? thread.title : (agent?.name ?? thread.title);
  // A routine's chat is one of its runs: its header names the routine and which run, and switches to another.
  const routineId = thread.kind === "routine" ? thread.routine_id : undefined;
  const routine = routineId ? data.routines.find((item) => item.id === routineId) : undefined;
  const title = routineId ? (routine?.name ?? routineName(thread)) : thread.title || name;
  const fresh = isNewChat(base.id);
  // What is typed stays as the chat's draft until it is sent.
  const [text, setTextNow] = useState(() => draftOf(base.id));
  useEffect(() => keepDraft(base.id, text), [base.id, text]);
  const setText = (value: string) => {
    keepDraft(base.id, value);
    setTextNow(value);
  };
  const [sheet, setSheet] = useState<"model" | "menu" | "attach" | "runs" | "browser">();
  // Files and voice notes of a new chat are uploaded to no chat yet; they go with its first message.
  const files = useAttachments(live.client, fresh ? undefined : base.id);
  const voice = useVoiceNote({
    client: live.client,
    threadId: fresh ? undefined : base.id,
    upload: files.upload,
    onWords: (words) => setTextNow((current) => (current.trim() ? `${current.trim()} ${words}` : words)),
  });
  const list = useRef<FlatList<TranscriptRow>>(null);
  // The messages are drawn once the screen has slid in: the slide starts at once instead of after the whole list.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const later = InteractionManager.runAfterInteractions(() => setSettled(true));
    return () => later.cancel();
  }, []);
  // What waits for the agent's next turn sits below the chat, in the order it will run, not where it was written.
  const line = useMemo(() => inLine(live.messages), [live.messages]);
  const rows = useMemo(() => withDays(outOfLine(live.messages)).reverse(), [live.messages]);
  const queue = useMemo(() => ({ actions: live.waiting }), [live.waiting]);
  const planAt = useMemo(() => latestPlan(live.messages), [live.messages]);
  const mailChannels = useMemo(
    () => new Set(data.channels.filter((c) => c.type === "email").map((c) => c.id)),
    [data.channels],
  );
  const [flash, setFlash] = useState<string>();
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current || !settled) return;
    const index = rows.findIndex((row) => row.kind !== "day" && row.message.id === focus);
    if (index < 0) return;
    focused.current = true;
    setFlash(focus);
    requestAnimationFrame(() => list.current?.scrollToIndex({ index, viewPosition: 0.5 }));
  }, [focus, rows, settled]);
  useEffect(() => {
    if (!flash) return;
    const off = setTimeout(() => setFlash(undefined), 2000);
    return () => clearTimeout(off);
  }, [flash]);
  const working = isWorking(live.state);
  const engine = thread.engine === "claude" || thread.engine === "codex" ? thread.engine : undefined;
  // A new chat keeps the model picked in it until it is made.
  const [freshChoice, setFreshChoice] = useState<ModelChoice>();
  const choice = fresh ? freshChoice : (thread as { model_choice?: ModelChoice }).model_choice;
  const [making, setMaking] = useState(false);
  const effective = choice ?? agent?.model_choice;
  const send = () => {
    if (making) return;
    const attachments = files.take();
    // The core wants words with every message; files alone say so, as the panel does.
    const words = text.trim() || (attachments.length ? t("attachedOnly") : "");
    if (!words) return;
    setText("");
    if (!fresh) return void live.send(words, attachments).catch(() => setText(words));
    setMaking(true);
    make(base).then(
      async (made) => {
        if (freshChoice)
          await live.client
            .call("threads.model", { thread: made.id, model_choice: freshChoice })
            .catch(() => undefined);
        // The chat is made: words a send then refuses wait in its own draft.
        await live.client
          .call("threads.send", { thread: made.id, text: words, ...(attachments.length ? { attachments } : {}) })
          .catch(() => keepDraft(made.id, words));
        onMade(made);
      },
      (error: unknown) => {
        setMaking(false);
        setText(words);
        Alert.alert(t("couldNotCreateChat"), error instanceof Error ? error.message : String(error));
      },
    );
  };
  const loadCatalog = useCallback(
    async () => (await live.client.call("models.list", {})).engines as CatalogEngine[],
    [live.client],
  );
  const doing = t(live.messages.at(-1)?.author.kind === "user" ? "isWorking" : "isAnswering", { name });
  const status = !live.online
    ? t("reconnecting")
    : working
      ? doing
      : live.state === "input-required"
        ? t("waitsForYourAnswer")
        : routineId
          ? runWhen(thread.updated_at)
          : threadContext(thread, data);
  const avatar = engine ? (
    <EngineIcon engine={engine} size={22} />
  ) : (
    <AgentAvatar name={name} blob={agent?.blob} id={agent?.id} size={22} />
  );
  return (
    <KeyboardAvoidingView
      style={s.root}
      // Android draws edge to edge, so the system no longer shrinks the window for the keyboard: pad on both.
      behavior="padding"
      // The screen starts below the status bar; the keyboard is measured from the top of the device.
      keyboardVerticalOffset={insets.top}
    >
      <View style={s.header}>
        <IconButton icon="ChevronLeft" label={t("back")} size={20} onPress={onBack} style={s.headerButton} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={routineId ? t("rtPickRun", { name: title }) : name}
          onPress={routineId ? () => setSheet("runs") : onSwitch}
          style={s.who}
        >
          <View>
            {engine ? (
              <EngineIcon engine={engine} size={30} />
            ) : contact ? (
              <PersonAvatar person={contact.person} name={contact.name} size={30} channel={contact.type} />
            ) : (
              <AgentAvatar name={name} blob={agent?.blob} id={agent?.id} size={30} />
            )}
            {live.online ? <View style={s.dot} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={s.title}>
              {title}
            </Text>
            <View style={s.status}>
              {working ? <Spinner size={11} /> : null}
              <Text numberOfLines={1} style={s.statusText} accessibilityLiveRegion="polite">
                {status}
              </Text>
              {routineId ? <Icon name="ChevronDown" size={12} color={theme.fgSubtle} /> : null}
            </View>
          </View>
        </Pressable>
        {routineId ? (
          <IconButton
            icon="History"
            label={t("rtPickRun", { name: title })}
            size={17}
            color={theme.fgMuted}
            style={s.headerButton}
            onPress={() => setSheet("runs")}
          />
        ) : (
          <IconButton
            icon="SquarePen"
            label={t("newChat")}
            size={17}
            color={theme.fgMuted}
            style={s.headerButton}
            onPress={onNewChat}
          />
        )}
        {/* A new chat has nothing to rename, archive or delete until its first message makes it. */}
        {fresh ? null : (
          <IconButton
            icon="MoreHorizontal"
            label={t("chatOptions")}
            size={17}
            color={theme.fgMuted}
            style={s.headerButton}
            onPress={() => setSheet("menu")}
          />
        )}
      </View>
      {!settled ? (
        <View style={s.empty} />
      ) : showsStartHint({ rows: rows.length, working, fresh, loaded: Boolean(live.thread) }) ? (
        <View style={s.empty}>
          <EmptyState icon="MessageCircle" title={t("chatWith", { name })} body={t("chatStartHint")} />
        </View>
      ) : (
        <MediaClient.Provider value={live.client}>
          <FlatList
            ref={list}
            inverted
            data={rows}
            keyExtractor={(row) => (row.kind === "day" ? row.key : row.message.id)}
            // Rows not drawn yet have no size: jump near by the average, then aim again.
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
              setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5 }), 120);
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={s.transcript}
            // The list is inverted: its header sits below the newest message, where the panel shows activity.
            ListHeaderComponent={
              working ? (
                <ActivityPill tone="brand" label={doing} from={avatar} />
              ) : live.state === "input-required" ? (
                <ActivityPill tone="danger" label={t("isWaitingForYou", { name })} />
              ) : null
            }
            ListHeaderComponentStyle={s.activity}
            renderItem={({ item }) =>
              item.kind === "day" ? (
                <Text style={s.day}>{dayLabel(item.at)}</Text>
              ) : thread.kind === "routine" &&
                item.message.author.kind === "user" &&
                item.message.id === live.messages[0]?.id ? (
                <RoutinePrompt name={routineName(thread)} message={item.message} />
              ) : (
                <View style={item.message.id === flash ? s.flash : undefined}>
                  <ChatMessage
                    message={item.message}
                    agents={data.agents}
                    waiting={live.state === "input-required"}
                    runState={live.state}
                    thread={thread}
                    projects={data.projects}
                    last={item.message.id === live.messages.at(-1)?.id}
                    client={live.client}
                    send={(words) => live.send(words)}
                    respond={live.respond}
                    goOn={(thread, mode) => live.client.call("threads.go_on", { thread, mode })}
                    continueSession={(session) => continueSession(live.client, session)}
                    sessionState={(session) => sessionState(live.client, session)}
                    {...(onOpenThread ? { openThread: onOpenThread } : {})}
                    mailChannels={mailChannels}
                    channels={data.channels}
                    queue={queue}
                    showPlan={item.message.id === planAt}
                  />
                </View>
              )
            }
          />
        </MediaClient.Provider>
      )}
      {live.computer ? <ComputerProgress stage={live.computer} /> : null}
      {live.error ? <Text style={s.error}>{live.error}</Text> : null}
      {/* What waits for the agent's next turn sits on the composer, in the order it will run. */}
      <QueueTray line={line} name={name} actions={live.waiting} />
      <ChatComposer
        text={text}
        onChangeText={setText}
        onSend={send}
        onStop={() => void live.stop()}
        onAttach={() => setSheet("attach")}
        attachments={files.items}
        onRemoveAttachment={files.remove}
        voice={{ ...voice, start: () => void voice.start(), stop: () => void voice.stop() }}
        onModel={() => setSheet("model")}
        online={live.online && !making}
        busy={working}
        stopping={live.stopping}
        agentName={name}
        model={engine ? engineName(engine) : choiceLabel(effective, [], t, t("router"))}
        usage={usageText(live.usage)}
      />
      {sheet === "attach" ? (
        <BottomSheet title={t("attach")} onClose={() => setSheet(undefined)}>
          {(
            [
              ["attachPhotos", "Image", files.pickPhotos],
              ["attachCamera", "Camera", files.takePhoto],
              ["attachFile", "Paperclip", files.pickFiles],
            ] as const
          ).map(([label, icon, run]) => (
            <ListRow
              key={label}
              label={t(label)}
              leading={<Icon name={icon} size={18} color={theme.fgMuted} />}
              chevron={false}
              onPress={() => {
                setSheet(undefined);
                void run();
              }}
            />
          ))}
        </BottomSheet>
      ) : null}
      {sheet === "browser" ? (
        <BrowserConsents
          client={live.client}
          thread={base.id}
          agents={data.agents}
          threads={data.threads}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === "runs" ? (
        <RoutineRunsSheet
          thread={thread}
          threads={data.threads}
          name={title}
          {...(routineRuns ? { loadRuns: routineRuns } : {})}
          onPick={(id) => onOpenRun?.(id)}
          {...(routineId && routine && onRoutine ? { onRoutine: () => onRoutine(routineId) } : {})}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
      {sheet === "model" ? (
        <ModelSheet
          current={choice}
          agentName={agent?.name ?? name}
          engine={thread.engine}
          loadCatalog={loadCatalog}
          onClose={() => setSheet(undefined)}
          onPick={(picked) => {
            setSheet(undefined);
            if (fresh) return setFreshChoice(picked ?? undefined);
            void live
              .setModel(picked)
              .catch((error) =>
                Alert.alert(t("couldNotChangeModel"), error instanceof Error ? error.message : String(error)),
              );
          }}
        />
      ) : null}
      {sheet === "menu" ? (
        <ChatMenu
          thread={thread}
          onClose={() => setSheet(undefined)}
          onApps={onApps}
          onSwitch={onSwitch}
          onBrowser={() => setSheet("browser")}
          update={async (patch) => {
            await live.client.call("threads.update", { thread: thread.id, ...patch });
          }}
          remove={async () => {
            await live.client.call("threads.delete", { thread: thread.id });
            onBack();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** A routine run opens with the routine's instructions: folded, so what the agent told stands out. */
function RoutinePrompt({ name, message }: { name: string; message: Message }) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((v) => !v)}
      style={s.routine}
    >
      <View style={s.routineHead}>
        <Icon name="Clock" size={14} color={theme.fgMuted} />
        <Text numberOfLines={1} style={s.routineLabel}>
          {t("routineInstructions", { name })}
        </Text>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.fgSubtle} />
      </View>
      {open ? <Text style={s.routineText}>{text}</Text> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  // The message a shared file led to, lit for a moment.
  flash: { borderRadius: theme.radiusMd, backgroundColor: theme.brandSoft },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: 2,
    paddingRight: 4,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  headerButton: { width: 40, height: 40 },
  who: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  dot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.brand,
    borderWidth: 2,
    borderColor: theme.bg,
  },
  title: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusText: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  transcript: { paddingHorizontal: 16, paddingVertical: 12 },
  empty: { flex: 1, justifyContent: "center" },
  activity: { paddingTop: 6 },
  day: { alignSelf: "center", color: theme.fgSubtle, fontSize: 12, paddingVertical: 8 },
  routine: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: 12, marginVertical: 6 },
  routineHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  routineLabel: { flex: 1, color: theme.fgMuted, fontSize: 13 },
  routineText: { color: theme.fgMuted, fontSize: 13, lineHeight: 19, paddingHorizontal: 12, paddingBottom: 12 },
  error: { color: theme.danger, paddingHorizontal: 16, paddingVertical: 4, fontSize: 12 },
}));
