import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Creds } from "./creds";
import { isWorking } from "./hooks/chatSelectors";
import { useThread } from "./hooks/useThread";
import type { Agent } from "./hooks/useWorkspace";
import type { Message } from "./protocol";
import { ChatComposer } from "./ui/ChatComposer";
import { ChatMessage } from "./ui/ChatMessage";
import { AgentAvatar, IconButton, Muted } from "./ui/components";
import { theme as t } from "./ui/theme";

const HOME = "home";
export function ChatScreen({
  creds,
  onUnpair,
  onApps,
  threadId = HOME,
  title = "APX",
  blob,
  onBack,
  onSwitch,
  agentId,
  agents = [],
}: {
  creds: Creds;
  onUnpair: () => void;
  onApps: () => void;
  threadId?: string;
  title?: string;
  blob?: string;
  onBack?: () => void;
  onSwitch?: () => void;
  agentId?: string;
  agents?: Agent[];
}) {
  const { messages, online, state, error, send: sendMessage, stop, stopping } = useThread(creds, threadId, onUnpair);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const list = useRef<FlatList<Message>>(null);
  const followLatest = useRef(true);
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const agentName = agents.find((agent) => agent.id === agentId)?.name ?? title;
  const pendingTool = messages.at(-1)?.parts.some((part) => part.type === "tool" && part.status === "running");
  const activity = `${agentName} está ${state === "submitted" || pendingTool ? "trabajando" : "respondiendo"}…`;
  const send = () => {
    const words = text.trim();
    if (!words) return;
    setText("");
    void sendMessage(words).catch(() => setText(words));
  };
  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={insets.top}
    >
      <View style={s.header}>
        {onBack ? <IconButton icon="ChevronLeft" label="Volver" onPress={onBack} /> : null}
        <AgentAvatar name={agentName} blob={blob} id={agentId} size={36} online={online} />
        <Pressable style={s.headerCopy} onPress={onSwitch} accessibilityLabel="Cambiar chat">
          <Text style={s.title}>{agentName}</Text>
          <Muted>
            {!online
              ? "Reconectando…"
              : isWorking(state)
                ? activity
                : state === "input-required"
                  ? "Espera tu respuesta"
                  : `${title} · conectado`}
          </Muted>
        </Pressable>
        <IconButton icon="SquarePen" label="Cambiar chat" onPress={onSwitch ?? (() => undefined)} />
        <IconButton icon="MoreHorizontal" label="Más opciones" onPress={onApps} />
      </View>
      <FlatList
        ref={list}
        key={threadId}
        inverted
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        data={newestFirst}
        keyExtractor={(message) => message.id}
        onContentSizeChange={() => {
          if (followLatest.current) list.current?.scrollToOffset({ offset: 0, animated: false });
        }}
        onScroll={({ nativeEvent }) => {
          followLatest.current = nativeEvent.contentOffset.y < 100;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={s.transcript}
        renderItem={({ item }) => <ChatMessage message={item} agents={agents} waiting={state === "input-required"} />}
      />
      {error ? (
        <Text style={{ color: t.danger, paddingHorizontal: 16, paddingVertical: 6, fontSize: 12 }}>{error}</Text>
      ) : null}
      {isWorking(state) ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 8 }}>
          <ActivityIndicator size="small" color={t.brand} />
          <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: 12 }}>
            {activity}
          </Text>
        </View>
      ) : null}
      <ChatComposer
        text={text}
        onChangeText={setText}
        onSend={send}
        onStop={() => void stop()}
        onApps={onApps}
        online={online}
        busy={isWorking(state)}
        stopping={stopping}
        agentName={agentName}
        model={messages.findLast((message) => message.model)?.model}
      />
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
  },
  headerCopy: { flex: 1 },
  title: { color: t.fg, fontWeight: "600", fontSize: 15 },
  transcript: { paddingHorizontal: 13, paddingTop: 10, paddingBottom: 18, gap: 8 },
  day: { textAlign: "center", paddingVertical: 9 },
});
