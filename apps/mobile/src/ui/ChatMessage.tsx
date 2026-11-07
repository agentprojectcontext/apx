import { type ReactNode, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { parseMarkdown, plainText } from "../chat/markdown";
import { type MediaItem, mediaRows } from "../chat/media";
import { viaOf } from "../chat/via";
import { clock } from "../format";
import type { Agent } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { type ApxClient, type Message, receivedMail } from "../protocol";
import { ActionGroup } from "./ActionGroup";
import { AgentEventCard } from "./chat/AgentEventCard";
import { BrowserCard } from "./chat/BrowserCard";
import { formsImage, isAgentEvent } from "./chat/blocks";
import { ChangesCard } from "./chat/ChangesCard";
import { ChoicesCard } from "./chat/ChoicesCard";
import { ConnectCard } from "./chat/ConnectCard";
import { EmailCard, MailContext } from "./chat/EmailCard";
import { ImageGenerating } from "./chat/ImageGenerating";
import { InputCard, type Respond } from "./chat/InputCard";
import { DeliveryTicks, Reactions, ViaMark } from "./chat/MessageMarks";
import { type ContinueSession, type GoOn, NoticeCard, type SessionState } from "./chat/NoticeCard";
import { PlanCard } from "./chat/PlanCard";
import { SkillsRow } from "./chat/SkillsRow";
import { SubthreadCard } from "./chat/SubthreadCard";
import { TakenMark, useTaken, type WaitingActions, WaitingControls } from "./chat/WaitingControls";
import { Icon } from "./Icon";
import { AgentAvatar } from "./kit";
import { Markdown } from "./Markdown";
import { MessageSheet } from "./MessageSheet";
import { ImageGrid } from "./media/ImageGrid";
import { MediaRow } from "./media/MediaRow";
import { MediaSheet } from "./media/MediaSheet";
import { MediaViewer } from "./media/MediaViewer";
import { VideoCarousel } from "./media/VideoCarousel";
import { makeStyles, useTheme } from "./theme";

export type { ContinueSession, GoOn, Respond };

type Open =
  | { kind: "text" }
  | { kind: "media"; item: MediaItem }
  | { kind: "viewer"; items: MediaItem[]; start: number };
/** The chat a message is in, as far as its blocks need it. */
export type ChatOf = {
  kind: string;
  agent_ids: string[];
  project_id?: string | undefined;
  channel?: { id: string } | undefined;
};

export function ChatMessage({
  message,
  agents,
  waiting = false,
  runState,
  thread,
  projects,
  last = false,
  client,
  send,
  respond,
  goOn,
  continueSession,
  sessionState,
  openThread,
  mailChannels,
  channels = [],
  queue,
  showPlan = true,
}: {
  message: Message;
  agents: Agent[];
  waiting?: boolean;
  /** The chat's run state: a picture being made shows forming while it works. */
  runState?: string;
  thread?: ChatOf;
  projects?: ReadonlyArray<{ id: string; name: string }>;
  /** The chat's newest message: offers (choices) wait only there. */
  last?: boolean;
  client?: ApxClient;
  /** Says something in this chat as the owner. */
  send?: (text: string) => Promise<unknown>;
  respond: Respond;
  goOn?: GoOn;
  continueSession?: ContinueSession;
  sessionState?: SessionState;
  /** Opens another chat: the one a sub-thread card stands for. */
  openThread?: (id: string) => void;
  /** The email channels' ids: what a contact wrote on one shows as a mail. */
  mailChannels?: ReadonlySet<string>;
  /** Whether its plan shows: only the chat's newest one does. */
  showPlan?: boolean;
  /** The office's chat apps: a message that came in or went out on one says so. */
  channels?: ReadonlyArray<{ id: string; type: string; label: string }>;
  /** What the owner can do with their own message while it waits; `line` when it waits in line for the next turn. */
  queue?: { actions: WaitingActions; line?: Message[] };
}) {
  const theme = useTheme();
  const s = useStyles();
  const mailContext = useMemo(() => ({ client, messageId: message.id }), [client, message.id]);
  const author = message.author;
  const mine = author.kind === "user";
  const tools = message.parts.filter((part) => part.type === "tool");
  const agent = author.kind === "agent" ? agents.find((one) => one.id === author.id) : undefined;
  const name =
    author.kind === "agent"
      ? (agent?.name ?? t("agent"))
      : "name" in author
        ? author.name
        : author.kind === "surface"
          ? author.title
          : "APX";
  const hasText = message.parts.some((part) => part.type === "text" && part.text.trim());
  const live = runState === "working" || runState === "submitted" || runState === "queued";
  const rows = useMemo(() => mediaRows(message.parts, { shown: showPlan, live }), [message.parts, showPlan, live]);
  const generating = formsImage(message.parts, runState);
  const event = thread ? isAgentEvent(thread, message) : false;
  const skills = event ? undefined : message.parts.find((part) => part.type === "skills");
  const [open, setOpen] = useState<Open>();
  // A copy is the message's words as they read: the owner's as typed, an agent's without the markdown marks.
  const words = () => {
    const text = message.parts.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []));
    return mine ? text.join("\n\n") : text.map((one) => plainText(parseMarkdown(one))).join("\n\n");
  };
  const menu = (item: MediaItem) => setOpen({ kind: "media", item });
  const pick = async (personality: string, said: string) => {
    if (!client || !send || author.kind !== "agent") return;
    await client.call("agents.update", { agent: author.id, personality });
    await send(t("choicesPersonality", { choice: said }));
  };
  const body: ReactNode[] = rows.map((row) => {
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
        if (author.kind === "person" && mailChannels?.has(author.channel)) {
          const { subject, body } = receivedMail(part.text);
          return <EmailCard key={key} mail={{ to: [], cc: [], from: author.name, subject, date: "", body }} />;
        }
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
          <NoticeCard key={key} part={part} goOn={goOn} continueSession={continueSession} sessionState={sessionState} />
        );
      case "subthread":
        return <SubthreadCard key={key} part={part} agents={agents} from={name} openThread={openThread} />;
      case "changes":
        return <ChangesCard key={key} part={part} />;
      case "browser":
        return <BrowserCard key={key} part={part} agentName={agent?.name ?? t("theAgent")} />;
      case "choices":
        return last && client && send && author.kind === "agent" ? (
          <ChoicesCard key={key} part={part} pick={pick} />
        ) : null;
      case "connect":
        return <ConnectCard key={key} part={part} client={client} />;
      case "plan":
        return <PlanCard key={key} label={t("plan")} steps={part.steps} />;
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
  });
  const content = (
    <>
      {skills?.type === "skills" ? <SkillsRow part={skills} client={client} projectId={thread?.project_id} /> : null}
      {tools.length > 0 ? <ActionGroup parts={tools} waiting={waiting} /> : null}
      {body}
      {generating ? <ImageGenerating /> : null}
    </>
  );
  const project = (() => {
    const id = message.parts.flatMap((part) => (part.type === "text" && part.response ? [part.response] : []))[0]
      ?.project_id;
    return id ? projects?.find((one) => one.id === id)?.name : undefined;
  })();
  // An emoji "by the agent" is the chat's own agent's, whoever wrote the message.
  const chatAgent = agents.find((one) => one.id === thread?.agent_ids[0])?.name;
  const ticks = message.delivery ? <DeliveryTicks state={message.delivery} /> : null;
  const taken = useTaken(message);
  // The engine notes when the agent's own model did not answer and a fallback did.
  const fellBack = message.parts.some((part) => part.type === "notice" && part.code === "engine.fallback");
  const via = viaOf(message, thread?.channel?.id, channels);
  const viaMark = via ? <ViaMark via={via} /> : null;
  return (
    <MailContext.Provider value={mailContext}>
      <View style={[s.wrap, mine ? s.mineWrap : s.theirsWrap]}>
        {author.kind === "person" ? (
          <View style={s.person}>
            <AgentAvatar name={author.name} size={26} />
            <View style={s.personBody}>{content}</View>
          </View>
        ) : event ? (
          <AgentEventCard message={message} name={name} project={project} openThread={openThread}>
            {content}
          </AgentEventCard>
        ) : (
          content
        )}
        {message.reactions?.length ? <Reactions list={message.reactions} agentName={chatAgent ?? name} /> : null}
        {mine ? (
          <>
            {message.waiting && queue ? (
              <WaitingControls
                message={message}
                actions={queue.actions}
                {...(queue.line ? { line: queue.line } : {})}
              />
            ) : null}
            <View style={[s.metaRow, { marginRight: 6 }]}>
              <Text style={s.meta}>{clock(message.created_at)}</Text>
              {viaMark}
              {ticks}
              {taken ? <TakenMark /> : null}
            </View>
          </>
        ) : hasText || message.model || message.delivery || via ? (
          <View style={[s.metaRow, { marginLeft: author.kind === "person" ? 40 : 6 }]}>
            <Text numberOfLines={1} style={[s.meta, { flexShrink: 1 }]}>
              {[name, message.model, fellBack ? t("modelFallback") : undefined, clock(message.created_at)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {viaMark}
            {ticks}
          </View>
        ) : null}
        {open?.kind === "text" ? <MessageSheet text={words()} onClose={() => setOpen(undefined)} /> : null}
        {open?.kind === "media" ? <MediaSheet item={open.item} onClose={() => setOpen(undefined)} /> : null}
        {open?.kind === "viewer" ? (
          <MediaViewer items={open.items} start={open.start} onClose={() => setOpen(undefined)} />
        ) : null}
      </View>
    </MailContext.Provider>
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
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { color: theme.fgSubtle, fontSize: 11, fontFamily: theme.mono },
  person: { flexDirection: "row", alignItems: "flex-end", gap: 8, alignSelf: "stretch" },
  personBody: { flex: 1, minWidth: 0, gap: 4, alignItems: "flex-start" },
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
}));
