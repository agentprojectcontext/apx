import { StyleSheet, Text, View } from "react-native";
import type { Agent } from "../hooks/useWorkspace";
import type { Message } from "../protocol";
import { ActionGroup } from "./ActionGroup";
import { Muted } from "./components";
import { Icon } from "./Icon";
import { theme as t } from "./theme";

export function ChatMessage({
  message,
  agents,
  waiting = false,
}: {
  message: Message;
  agents: Agent[];
  waiting?: boolean;
}) {
  const mine = message.author.kind === "user";
  const tools = message.parts.filter((part) => part.type === "tool");
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
      {tools.length > 0 ? <ActionGroup parts={tools} waiting={waiting} /> : null}
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
              <Icon name="FileText" size={14} />
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
});
