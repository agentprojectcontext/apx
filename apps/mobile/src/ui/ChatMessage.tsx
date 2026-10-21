import { useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { parseMarkdown, plainText } from "../chat/markdown";
import { type MediaItem, mediaRows } from "../chat/media";
import { clock } from "../format";
import { stateMark } from "../hooks/chatSelectors";
import type { Agent } from "../hooks/useWorkspace";
import { lang, t } from "../i18n";
import { type Answer, type Message, noticeText } from "../protocol";
import { ActionGroup } from "./ActionGroup";
import { Icon } from "./Icon";
import { Button, Spinner, Tag } from "./kit";
import { Markdown } from "./Markdown";
import { MessageSheet } from "./MessageSheet";
import { ImageGrid } from "./media/ImageGrid";
import { MediaRow } from "./media/MediaRow";
import { MediaSheet } from "./media/MediaSheet";
import { MediaViewer } from "./media/MediaViewer";
import { VideoCarousel } from "./media/VideoCarousel";
import { makeStyles, useTheme } from "./theme";

type Part = Message["parts"][number];
type InputPart = Extract<Part, { type: "input" }>;
export type Respond = (input: string, answer: Answer) => Promise<void>;
/** Lets a conversation the breaker paused go on: a fresh budget, or no limit until the owner writes there again. */
export type GoOn = (thread: string, mode: "reset" | "release") => Promise<unknown>;
/** Lets a delegated session a limit stopped go on with one more turn, as Continue on the web does. */
export type ContinueSession = (session: string) => Promise<unknown>;
type Open =
  | { kind: "text" }
  | { kind: "media"; item: MediaItem }
  | { kind: "viewer"; items: MediaItem[]; start: number };

export function ChatMessage({
  message,
  agents,
  waiting = false,
  respond,
  goOn,
  continueSession,
  openThread,
}: {
  message: Message;
  agents: Agent[];
  waiting?: boolean;
  respond: Respond;
  goOn?: GoOn;
  continueSession?: ContinueSession;
  /** Opens another chat: the one a sub-thread card stands for. */
  openThread?: (id: string) => void;
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
  const rows = useMemo(() => mediaRows(message.parts), [message.parts]);
  const [open, setOpen] = useState<Open>();
  // A copy is the message's words as they read: the owner's as typed, an agent's without the markdown marks.
  const words = () => {
    const text = message.parts.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []));
    return mine ? text.join("\n\n") : text.map((one) => plainText(parseMarkdown(one))).join("\n\n");
  };
  const menu = (item: MediaItem) => setOpen({ kind: "media", item });
  return (
    <View style={[s.wrap, mine ? s.mineWrap : s.theirsWrap]}>
      {tools.length > 0 ? <ActionGroup parts={tools} waiting={waiting} /> : null}
      {rows.map((row) => {
        const key = row.key;
        if (row.kind === "images")
          return (
            <ImageGrid
              key={key}
              items={row.items}
              onOpen={(start) => setOpen({ kind: "viewer", items: row.items, start })}
              onMenu={menu}
            />
          );
        if (row.kind === "videos") return <VideoCarousel key={key} items={row.items} onMenu={menu} />;
        if (row.kind === "media") return <MediaRow key={key} item={row.item} onMenu={menu} />;
        const part = row.part;
        switch (part.type) {
          case "text":
            if (!part.text.trim()) return null;
            return (
              <Pressable
                key={key}
                accessibilityHint={t("messageMenuHint")}
                onLongPress={() => setOpen({ kind: "text" })}
                delayLongPress={350}
                style={({ pressed }) => [s.bubble, mine ? s.mineBox : s.theirs, pressed && { opacity: 0.85 }]}
              >
                {mine ? <Text style={s.mineText}>{part.text}</Text> : <Markdown text={part.text} selectable={false} />}
              </Pressable>
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
                <Text style={[s.noticeText, part.level === "error" && { color: theme.danger }]}>
                  {noticeText(part, lang)}
                </Text>
                {part.detail ? (
                  <Text numberOfLines={2} style={s.code}>
                    {part.detail}
                  </Text>
                ) : null}
                {goOn && part.code.startsWith("breaker.") && typeof part.vars?.thread === "string" ? (
                  <BreakerActions thread={part.vars.thread} goOn={goOn} />
                ) : null}
                {continueSession &&
                part.code === "delegation.limit" &&
                !String(part.vars?.variant).startsWith("continued") &&
                typeof part.vars?.subthread === "string" ? (
                  <DelegationContinue session={part.vars.subthread} continueSession={continueSession} />
                ) : null}
              </View>
            );
          case "subthread":
            // Another agent's part (a delegation, a consult on a task): who, and what it answered.
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={t("openSubthread", {
                  name: agents.find((agent) => agent.id === part.agent_id)?.name ?? part.worker ?? t("agent"),
                })}
                disabled={!openThread}
                onPress={() => openThread?.(part.thread_id)}
                style={({ pressed }) => [s.subthread, pressed && { backgroundColor: theme.fill }]}
              >
                <View style={s.subthreadHead}>
                  {stateMark(part.state) === "queued" ? (
                    <Icon name="Clock" size={14} color={theme.fgSubtle} />
                  ) : stateMark(part.state) === "working" ? (
                    <Spinner size={14} />
                  ) : (
                    <Icon name={stateMark(part.state) === "failed" ? "X" : "Check"} size={14} color={theme.fgSubtle} />
                  )}
                  <Text numberOfLines={1} style={s.lineText}>
                    {agents.find((agent) => agent.id === part.agent_id)?.name ?? part.worker ?? t("agent")} ·{" "}
                    {stateMark(part.state) === "queued" ? `${t("queued")} · ` : ""}
                    {part.title}
                  </Text>
                </View>
                {part.summary ? (
                  <Text numberOfLines={8} style={s.subthreadText}>
                    {plainText(parseMarkdown(part.summary))}
                  </Text>
                ) : null}
              </Pressable>
            );
          case "changes":
            return (
              <View key={key} style={s.line}>
                <Icon name="FileText" size={14} color={theme.fgMuted} />
                <Text style={s.lineText}>{t("filesChanged", { n: part.files.length + (part.more ?? 0) })}</Text>
              </View>
            );
          case "file":
            // Only a document snapshot gets here; other files are media rows.
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
      {open?.kind === "text" ? <MessageSheet text={words()} onClose={() => setOpen(undefined)} /> : null}
      {open?.kind === "media" ? <MediaSheet item={open.item} onClose={() => setOpen(undefined)} /> : null}
      {open?.kind === "viewer" ? (
        <MediaViewer items={open.items} start={open.start} onClose={() => setOpen(undefined)} />
      ) : null}
    </View>
  );
}

/** Continue on a delegated session a limit stopped: one more turn, judged again by the core when pressed. */
function DelegationContinue({ session, continueSession }: { session: string; continueSession: ContinueSession }) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <Text style={s.noticeDone}>{t("delegationWentOn")}</Text>;
  const go = () => {
    setBusy(true);
    continueSession(session)
      .then(() => setDone(true))
      .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={s.noticeActions}>
      <Button size="sm" label={t("delegationContinue")} busy={busy} disabled={busy} onPress={go} />
    </View>
  );
}

/** A confirmation or a question waiting in the chat, answered right here. */
/** A paused chain's way on, as on the web: a fresh budget, or no limit this round (DECISIONS.md#d-081). */
function BreakerActions({ thread, goOn }: { thread: string; goOn: GoOn }) {
  const s = useStyles();
  const [busy, setBusy] = useState<"reset" | "release">();
  const [done, setDone] = useState(false);
  if (done) return <Text style={s.noticeDone}>{t("breakerWentOn")}</Text>;
  const go = (mode: "reset" | "release") => {
    setBusy(mode);
    goOn(thread, mode)
      .then(() => setDone(true))
      .catch((e: unknown) => Alert.alert(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(undefined));
  };
  return (
    <View style={s.noticeActions}>
      <Button
        size="sm"
        label={t("breakerReset")}
        busy={busy === "reset"}
        disabled={Boolean(busy)}
        onPress={() => go("reset")}
      />
      <Button
        size="sm"
        variant="secondary"
        label={t("breakerRelease")}
        busy={busy === "release"}
        disabled={Boolean(busy)}
        onPress={() => go("release")}
      />
    </View>
  );
}

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
  bubble: { paddingVertical: 11, paddingHorizontal: 14, overflow: "hidden" },
  mineBox: {
    backgroundColor: theme.accent,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 6,
  },
  theirs: {
    maxWidth: "88%",
    backgroundColor: theme.fill,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 6,
  },
  mineText: { color: theme.accentFg, fontSize: 15, lineHeight: 21 },
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
  noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%" },
  noticeDone: { color: theme.fgMuted, fontSize: 12, width: "100%" },
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
  subthread: {
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    maxWidth: "88%",
  },
  subthreadHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  subthreadText: { color: theme.fg, fontSize: 14, lineHeight: 20 },
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
