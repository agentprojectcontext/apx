import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Creds } from "./creds";
import { isWorking } from "./hooks/chatSelectors";
import { useThread } from "./hooks/useThread";
import type { Agent } from "./hooks/useWorkspace";
import type { Message } from "./protocol";
import { AgentAvatar, IconButton, Muted } from "./ui/components";
import { Icon } from "./ui/Icon";
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
  const { messages, online, state, error, send: sendMessage } = useThread(creds, threadId, onUnpair);
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
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
        renderItem={({ item }) => <MessageRow message={item} agents={agents} />}
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
      <View style={s.composer}>
        <TextInput
          multiline
          value={text}
          onChangeText={setText}
          placeholder={`Escribile a ${agentName}…`}
          placeholderTextColor={t.subtle}
          style={s.input}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <View style={s.composerBottom}>
          <Pressable onPress={onApps} style={s.composeChip}>
            <Icon name="Plus" size={20} color={t.muted} />
          </Pressable>
          <View style={s.composeChip}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8 }}>
              <Icon name="Bot" size={13} />
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, maxWidth: 150 }}>
                {messages.findLast((message) => message.model)?.model ?? agentName}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1 }} />
          <Icon name="Zap" size={14} color={t.subtle} />
          <Pressable
            onPress={send}
            disabled={!online || !text.trim()}
            style={[s.send, (!online || !text.trim()) && s.sendDisabled]}
          >
            <Icon name="ArrowUp" size={20} color={online && text.trim() ? t.accentFg : t.muted} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
function MessageRow({ message, agents }: { message: Message; agents: Agent[] }) {
  const mine = message.author.kind === "user";
  const occurrences = new Map<string, number>();
  const author = message.author;
  const authorName =
    author.kind === "agent"
      ? (agents.find((agent) => agent.id === author.id)?.name ?? "Agente")
      : "name" in author
        ? author.name
        : "APX";
  return (
    <View style={[s.messageWrap, mine ? s.mineWrap : s.agentWrap]}>
      {message.parts.map((part) => {
        const base = part.type === "tool" ? part.call_id : part.type === "input" ? part.input_id : part.type;
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        const key = `${base}:${occurrence}`;
        if (part.type === "text")
          return (
            <View key={key} style={[s.bubble, mine ? s.mine : s.theirs]}>
              <Text style={[s.messageText, mine && s.userText]}>{part.text}</Text>
            </View>
          );
        if (part.type === "tool")
          return (
            <View key={key} style={s.tool}>
              <Text style={s.toolMark}>{part.status === "error" ? "⚠" : part.status === "ok" ? "✓" : "◌"}</Text>
              <Text style={s.toolText} numberOfLines={2}>
                {part.title}
                {part.detail ? ` · ${part.detail}` : ""}
              </Text>
            </View>
          );
        if (part.type === "input")
          return (
            <View key={key} style={s.inputCard}>
              <Text style={s.inputBadge}>Compromiso · {part.state === "pending" ? "Pendiente" : "Respondido"}</Text>
              <Text style={s.messageText}>{part.prompt}</Text>
            </View>
          );
        if (part.type === "notice")
          return (
            <View key={key} style={s.notice}>
              <Text style={s.noticeText}>{part.text}</Text>
            </View>
          );
        if (part.type === "changes")
          return (
            <View key={key} style={s.tool}>
              <Text style={s.toolMark}>✓</Text>
              <Text style={s.toolText}>Cambios · {part.files.length} archivos</Text>
            </View>
          );
        return null;
      })}
      {!mine ? (
        <Muted style={s.author}>
          {authorName}
          {message.model ? ` · ${message.model}` : ""} · {time(message.created_at)}
        </Muted>
      ) : null}
      {mine ? <Muted style={s.timestamp}>{time(message.created_at)}</Muted> : null}
    </View>
  );
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(date);
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
  messageWrap: { maxWidth: "92%", gap: 4 },
  mineWrap: { alignSelf: "flex-end", alignItems: "flex-end" },
  agentWrap: { alignSelf: "flex-start", alignItems: "flex-start" },
  author: { marginLeft: 6, fontSize: 10 },
  bubble: { paddingVertical: 11, paddingHorizontal: 13, borderRadius: 18 },
  mine: { backgroundColor: t.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: t.fillHover, borderBottomLeftRadius: 6 },
  messageText: { color: t.fg, fontSize: 14, lineHeight: 21 },
  userText: { color: t.accentFg },
  tool: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface,
  },
  toolMark: { color: t.brand, fontSize: 14 },
  toolText: { color: t.muted, fontSize: 12, flex: 1 },
  inputCard: {
    padding: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 16,
    backgroundColor: t.surface,
    gap: 7,
  },
  inputBadge: { color: t.violet, fontSize: 11 },
  notice: { padding: 9, backgroundColor: t.warningSoft, borderRadius: 12 },
  noticeText: { color: t.warning, fontSize: 12 },
  timestamp: { fontSize: 10, marginRight: 4 },
  composer: {
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 20,
    backgroundColor: t.surface,
    marginHorizontal: 10,
    marginBottom: 8,
  },
  input: { maxHeight: 120, minHeight: 35, color: t.fg, fontSize: 14, paddingVertical: 5 },
  composerBottom: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8 },
  composeChip: {
    minWidth: 32,
    height: 30,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.fill,
  },
  composeGlyph: { color: t.fg, fontSize: 19 },
  model: { color: t.muted, paddingHorizontal: 8, fontSize: 11 },
  counter: { color: t.subtle, marginHorizontal: 4 },
  send: {
    width: 34,
    height: 34,
    borderRadius: 18,
    backgroundColor: t.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: t.fill },
  sendText: { color: t.accentFg, fontSize: 22, lineHeight: 25 },
});
