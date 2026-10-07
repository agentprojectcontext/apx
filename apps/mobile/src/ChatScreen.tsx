import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type CatalogEngine, choiceText, type ModelChoice } from "./chat/models";
import { type TranscriptRow, usageText, withDays } from "./chat/transcript";
import { useAttachments } from "./chat/useAttachments";
import { useVoiceNote } from "./chat/useVoiceNote";
import type { Creds } from "./creds";
import { dayLabel } from "./format";
import { engineName, isWorking, threadContext } from "./hooks/chatSelectors";
import { useThread } from "./hooks/useThread";
import type { Thread, Workspace } from "./hooks/useWorkspace";
import { t } from "./i18n";
import { ChatComposer } from "./ui/ChatComposer";
import { ChatMenu } from "./ui/ChatMenu";
import { ChatMessage } from "./ui/ChatMessage";
import { EngineIcon } from "./ui/EngineIcon";
import { Icon } from "./ui/Icon";
import { AgentAvatar, BottomSheet, IconButton, ListRow, Spinner } from "./ui/kit";
import { ModelSheet } from "./ui/ModelSheet";
import { theme } from "./ui/theme";

export function ChatScreen({
  creds,
  onUnpair,
  onApps,
  base,
  data,
  onBack,
  onSwitch,
  onNewChat,
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
}) {
  const live = useThread(creds, base.id, onUnpair);
  const insets = useSafeAreaInsets();
  const thread = (live.thread as Thread | undefined) ?? base;
  const agent = data.agents.find((item) => item.id === thread.agent_ids[0]);
  const name = thread.engine ? thread.title : (agent?.name ?? thread.title);
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<"model" | "menu" | "attach">();
  const files = useAttachments(live.client, base.id);
  const voice = useVoiceNote({
    client: live.client,
    threadId: base.id,
    upload: files.upload,
    onWords: (words) => setText((current) => (current.trim() ? `${current.trim()} ${words}` : words)),
  });
  const list = useRef<FlatList<TranscriptRow>>(null);
  const rows = useMemo(() => withDays(live.messages).reverse(), [live.messages]);
  const working = isWorking(live.state);
  const engine = thread.engine === "claude" || thread.engine === "codex" ? thread.engine : undefined;
  const choice = (thread as { model_choice?: ModelChoice }).model_choice;
  const effective = choice ?? agent?.model_choice;
  const send = () => {
    const attachments = files.take();
    // The core wants words with every message; files alone say so, as the panel does.
    const words = text.trim() || (attachments.length ? t("attachedOnly") : "");
    if (!words) return;
    setText("");
    void live.send(words, attachments).catch(() => setText(words));
  };
  const loadCatalog = useCallback(
    async () => (await live.client.call("models.list", {})).engines as CatalogEngine[],
    [live.client],
  );
  const status = !live.online
    ? t("reconnecting")
    : working
      ? t(live.messages.at(-1)?.author.kind === "user" ? "isWorking" : "isAnswering", { name })
      : live.state === "input-required"
        ? t("waitsForYourAnswer")
        : threadContext(thread, data);
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
        <IconButton
          icon="MoreHorizontal"
          label={t("chatOptions")}
          size={18}
          color={theme.fgMuted}
          onPress={() => setSheet("menu")}
        />
      </View>
      <FlatList
        ref={list}
        inverted
        data={rows}
        keyExtractor={(row) => (row.kind === "day" ? row.key : row.message.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={s.transcript}
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <Text style={s.day}>{dayLabel(item.at)}</Text>
          ) : (
            <ChatMessage
              message={item.message}
              agents={data.agents}
              waiting={live.state === "input-required"}
              respond={live.respond}
            />
          )
        }
      />
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
        online={live.online}
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

const s = StyleSheet.create({
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
  day: { alignSelf: "center", color: theme.fgSubtle, fontSize: 12, paddingVertical: 8 },
  error: { color: theme.danger, paddingHorizontal: 16, paddingVertical: 4, fontSize: 12 },
});
