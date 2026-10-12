import { useState } from "react";
import { Alert, Image, Text, TextInput, View } from "react-native";
import { clock } from "../format";
import { isWorking } from "../hooks/chatSelectors";
import type { Agent } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { Answer, Message } from "../protocol";
import { ActionGroup } from "./ActionGroup";
import { Icon } from "./Icon";
import { Button, Spinner, Tag } from "./kit";
import { Markdown } from "./Markdown";
import { makeStyles, useTheme } from "./theme";

type Part = Message["parts"][number];
type InputPart = Extract<Part, { type: "input" }>;
export type Respond = (input: string, answer: Answer) => Promise<void>;

export function ChatMessage({
  message,
  agents,
  waiting = false,
  respond,
}: {
  message: Message;
  agents: Agent[];
  waiting?: boolean;
  respond: Respond;
}) {
  const theme = useTheme();
  const s = useStyles();
  const author = message.author;
  const mine = author.kind === "user";
  const tools = message.parts.filter((part) => part.type === "tool");
  const name =
    author.kind === "agent"
      ? (agents.find((agent) => agent.id === author.id)?.name ?? t("agent"))
      : "name" in author
        ? author.name
        : author.kind === "surface"
          ? author.title
          : "APX";
  const hasText = message.parts.some((part) => part.type === "text" && part.text.trim());
  const keys = new Map<string, number>();
  const keyOf = (part: Part) => {
    const base = part.type === "tool" ? part.call_id : part.type === "input" ? part.input_id : part.type;
    const n = keys.get(base) ?? 0;
    keys.set(base, n + 1);
    return `${base}:${n}`;
  };
  return (
    <View style={[s.wrap, mine ? s.mineWrap : s.theirsWrap]}>
      {tools.length > 0 ? <ActionGroup parts={tools} waiting={waiting} /> : null}
      {message.parts.map((part) => {
        const key = keyOf(part);
        switch (part.type) {
          case "text":
            if (!part.text.trim()) return null;
            return mine ? (
              <Text key={key} selectable style={[s.bubble, s.mine]}>
                {part.text}
              </Text>
            ) : (
              <View key={key} style={[s.bubble, s.theirs]}>
                <Markdown text={part.text} />
              </View>
            );
          case "input":
            return <InputCard key={key} part={part} respond={respond} />;
          case "notice":
            return (
              <View key={key} style={s.notice}>
                <Icon
                  name="TriangleAlert"
                  size={16}
                  color={part.level === "error" ? theme.danger : part.level === "warn" ? theme.warning : theme.fgMuted}
                />
                <Text style={[s.noticeText, part.level === "error" && { color: theme.danger }]}>{part.text}</Text>
                {part.detail ? (
                  <Text numberOfLines={2} style={s.code}>
                    {part.detail}
                  </Text>
                ) : null}
              </View>
            );
          case "subthread":
            return (
              <View key={key} style={s.line}>
                {isWorking(part.state) ? (
                  <Spinner size={14} />
                ) : (
                  <Icon name={part.state === "failed" ? "X" : "Check"} size={14} color={theme.fgSubtle} />
                )}
                <Text numberOfLines={1} style={s.lineText}>
                  {agents.find((agent) => agent.id === part.agent_id)?.name ?? part.worker ?? t("agent")} · {part.title}
                </Text>
              </View>
            );
          case "changes":
            return (
              <View key={key} style={s.line}>
                <Icon name="FileText" size={14} color={theme.fgMuted} />
                <Text style={s.lineText}>{t("filesChanged", { n: part.files.length + (part.more ?? 0) })}</Text>
              </View>
            );
          case "file":
            return (
              <View key={key} style={s.line}>
                <Icon name="FileText" size={14} color={theme.fgMuted} />
                <Text numberOfLines={1} style={s.lineText}>
                  {part.document?.title ?? part.name}
                </Text>
              </View>
            );
          case "surface":
            return (
              <View key={key} style={s.line}>
                <Icon name="LayoutGrid" size={14} color={theme.fgMuted} />
                <Text numberOfLines={1} style={s.lineText}>
                  {part.title}
                </Text>
              </View>
            );
          case "image":
            return part.url ? (
              <Image
                key={key}
                accessibilityLabel={part.alt}
                source={{ uri: part.url }}
                resizeMode="cover"
                style={s.image}
              />
            ) : null;
          default:
            return null;
        }
      })}
      {mine ? (
        <Text style={[s.meta, { marginRight: 6 }]}>{clock(message.created_at)}</Text>
      ) : hasText || message.model ? (
        <Text numberOfLines={1} style={[s.meta, { marginLeft: 6 }]}>
          {[name, message.model, clock(message.created_at)].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

/** A confirmation or a question waiting in the chat, answered right here. */
function InputCard({ part, respond }: { part: InputPart; respond: Respond }) {
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState<string>();
  const [reply, setReply] = useState("");
  const pending = part.state === "pending";
  const answer = (key: string, value: Answer) => {
    setBusy(key);
    respond(part.input_id, value)
      .catch((error) => Alert.alert(t("couldNotAnswer"), error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Tag tone={part.kind === "confirm" ? "violet" : "info"}>
          {t(part.kind === "confirm" ? "inboxApproval" : "inboxQuestion")}
        </Tag>
        <Text style={s.cardState}>
          {pending ? t("waitsForYou") : part.state === "withdrawn" ? t("withdrawn") : (part.answer ?? t("answered"))}
        </Text>
      </View>
      <Text style={s.cardText}>{part.prompt}</Text>
      {part.detail ? (
        <Text numberOfLines={4} style={s.code}>
          {part.detail}
        </Text>
      ) : null}
      {pending && part.kind === "confirm" && part.approval_scopes ? (
        <Text style={s.cardHelp}>{t("scopeHelp")}</Text>
      ) : null}
      {pending ? (
        <View style={s.cardActions}>
          {part.kind === "confirm" ? (
            <>
              <Button
                size="md"
                label={t(part.approval_scopes ? "approveOnce" : "approve")}
                busy={busy === "approve"}
                disabled={Boolean(busy)}
                onPress={() => answer("approve", { decision: "approve" })}
              />
              {part.approval_scopes?.includes("session") ? (
                <Button
                  size="md"
                  variant="secondary"
                  label={t("approveSession")}
                  busy={busy === "session"}
                  disabled={Boolean(busy)}
                  onPress={() => answer("session", { decision: "approve", scope: "session" })}
                />
              ) : null}
              {part.approval_scopes?.includes("always") ? (
                <Button
                  size="md"
                  variant="secondary"
                  label={t("approveAlways")}
                  busy={busy === "always"}
                  disabled={Boolean(busy)}
                  onPress={() => answer("always", { decision: "approve", scope: "always" })}
                />
              ) : null}
              <Button
                size="md"
                variant="secondary"
                label={t("deny")}
                busy={busy === "deny"}
                disabled={Boolean(busy)}
                onPress={() => answer("deny", { decision: "deny" })}
              />
            </>
          ) : (
            (part.options ?? []).map((option) => (
              <Button
                key={option}
                size="md"
                variant="secondary"
                label={option}
                busy={busy === option}
                disabled={Boolean(busy)}
                onPress={() => answer(option, { text: option })}
              />
            ))
          )}
        </View>
      ) : null}
      {pending && part.kind !== "confirm" ? (
        <View style={s.reply}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={t("yourAnswer")}
            placeholderTextColor={theme.fgSubtle}
            multiline
            style={s.replyInput}
          />
          <Button
            size="md"
            label={t("send")}
            busy={busy === "text"}
            disabled={Boolean(busy) || !reply.trim()}
            onPress={() => answer("text", { text: reply.trim() })}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: { gap: 4, marginVertical: 5 },
  mineWrap: { alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "82%" },
  theirsWrap: { alignSelf: "stretch", alignItems: "flex-start" },
  bubble: { paddingVertical: 11, paddingHorizontal: 14, fontSize: 15, lineHeight: 21, overflow: "hidden" },
  mine: {
    backgroundColor: theme.accent,
    color: theme.accentFg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 6,
  },
  theirs: {
    maxWidth: "88%",
    backgroundColor: theme.fill,
    color: theme.fg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 6,
  },
  meta: { color: theme.fgSubtle, fontSize: 11, fontFamily: theme.mono },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.fill,
    maxWidth: "88%",
  },
  noticeText: { color: theme.warning, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  code: { color: theme.fgMuted, fontSize: 12, fontFamily: theme.mono },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    maxWidth: "88%",
  },
  lineText: { color: theme.fgMuted, fontSize: 13, flexShrink: 1 },
  image: { width: 240, height: 180, borderRadius: 14, backgroundColor: theme.fill },
  card: {
    alignSelf: "stretch",
    padding: 14,
    gap: 10,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardState: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  cardText: { color: theme.fg, fontSize: 15, fontWeight: "500" },
  reply: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  replyInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 14,
  },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cardHelp: { color: theme.fgMuted, fontSize: 12, lineHeight: 16 },
}));
