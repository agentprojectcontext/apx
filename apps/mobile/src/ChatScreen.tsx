import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { draftOf, keepDraft } from "./chat/drafts";
import { type CatalogEngine, choiceText, type ModelChoice } from "./chat/models";
import { isNewChat } from "./chat/newChat";
import { showsStartHint, type TranscriptRow, usageText, withDays } from "./chat/transcript";
import { useAttachments } from "./chat/useAttachments";
import { useVoiceNote } from "./chat/useVoiceNote";
import type { Creds } from "./creds";
import { dayLabel } from "./format";
import { engineName, isWorking, routineName, threadContext } from "./hooks/chatSelectors";
import { continueSession } from "./hooks/continueSession";
import { useThread } from "./hooks/useThread";
import type { Thread, Workspace } from "./hooks/useWorkspace";
import { t } from "./i18n";
import type { Message } from "./protocol";
import { ChatComposer } from "./ui/ChatComposer";
import { ChatMenu } from "./ui/ChatMenu";
import { ChatMessage } from "./ui/ChatMessage";
import { EngineIcon } from "./ui/EngineIcon";
import { Icon } from "./ui/Icon";
import { ActivityPill, AgentAvatar, BottomSheet, EmptyState, IconButton, ListRow, Spinner } from "./ui/kit";
import { ModelSheet } from "./ui/ModelSheet";
import { MediaClient } from "./ui/media/context";
import { makeStyles, useTheme } from "./ui/theme";

export function ChatScreen({
  creds,
  onUnpair,
  onApps,
  base,
  data,
  onBack,
  onSwitch,
  onNewChat,
  make,
  onMade,
  onOpenThread,
}: {
  creds: Creds;
  onUnpair: () => void;
  onApps: () => void;
  /** The chat as the list knows it, until the live one loads. */
  base: Thread;
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
}) {
  const theme = useTheme();
  const s = useStyles();
  const live = useThread(creds, base.id, onUnpair);
  const insets = useSafeAreaInsets();
  const thread = (live.thread as Thread | undefined) ?? base;
  const agent = data.agents.find((item) => item.id === thread.agent_ids[0]);
  const name = thread.engine ? thread.title : (agent?.name ?? thread.title);
  const fresh = isNewChat(base.id);
  // What is typed stays as the chat's draft until it is sent.
  const [text, setTextNow] = useState(() => draftOf(base.id));
  useEffect(() => keepDraft(base.id, text), [base.id, text]);
  const setText = (value: string) => {
    keepDraft(base.id, value);
    setTextNow(value);
  };
  const [sheet, setSheet] = useState<"model" | "menu" | "attach">();
  // Files and voice notes of a new chat are uploaded to no chat yet; they go with its first message.
  const files = useAttachments(live.client, fresh ? undefined : base.id);
  const voice = useVoiceNote({
    client: live.client,
    threadId: fresh ? undefined : base.id,
    upload: files.upload,
    onWords: (words) => setTextNow((current) => (current.trim() ? `${current.trim()} ${words}` : words)),
  });
  const list = useRef<FlatList<TranscriptRow>>(null);
  const rows = useMemo(() => withDays(live.messages).reverse(), [live.messages]);
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
        <IconButton icon="ChevronLeft" label={t("back")} size={22} onPress={onBack} />
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onSwitch} style={s.who}>
          <View>
            {engine ? (
              <EngineIcon engine={engine} size={36} />
            ) : (
              <AgentAvatar name={name} blob={agent?.blob} id={agent?.id} size={36} />
            )}
            {live.online ? <View style={s.dot} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={s.title}>
              {thread.title || name}
            </Text>
            <View style={s.status}>
              {working ? <Spinner size={12} /> : null}
              <Text numberOfLines={1} style={s.statusText} accessibilityLiveRegion="polite">
                {status}
              </Text>
            </View>
          </View>
        </Pressable>
        <IconButton icon="SquarePen" label={t("newChat")} size={18} color={theme.fgMuted} onPress={onNewChat} />
        {/* A new chat has nothing to rename, archive or delete until its first message makes it. */}
        {fresh ? null : (
          <IconButton
            icon="MoreHorizontal"
            label={t("chatOptions")}
            size={18}
            color={theme.fgMuted}
            onPress={() => setSheet("menu")}
          />
        )}
      </View>
      {showsStartHint({ rows: rows.length, working, fresh, loaded: Boolean(live.thread) }) ? (
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
                <ChatMessage
                  message={item.message}
                  agents={data.agents}
                  waiting={live.state === "input-required"}
                  respond={live.respond}
                  goOn={(thread, mode) => live.client.call("threads.go_on", { thread, mode })}
                  continueSession={(session) => continueSession(live.client, session)}
                  {...(onOpenThread ? { openThread: onOpenThread } : {})}
                />
              )
            }
          />
        </MediaClient.Provider>
      )}
      {live.error ? <Text style={s.error}>{live.error}</Text> : null}
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
        model={engine ? engineName(engine) : choiceText(effective, [], t("router"))}
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
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  who: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
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
  title: { color: theme.fg, fontSize: 16, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
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
