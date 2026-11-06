import type { Agent, Message as Msg, Part, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon, IconButton, Icons, MarkdownView, Message, MessageMeta } from "@apx/ui";
import { type ReactNode, Suspense, useState } from "react";
import { DeliveryTicks, ReactionList, ViaMark } from "../channels/MessageMarks.tsx";
import { isSignal } from "../channels/signal.ts";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { blobOf } from "../data/identity.ts";
import { baseRef, effortLabel, modelOf, splitRef, useModels } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import {
  BrowserPart,
  ChoicesPart,
  ConnectPart,
  FlowCard,
  InputPart,
  MediaGroup,
  ReceivedDialog,
  SubthreadPart,
  SurfacePart,
} from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { copyableQuote } from "./CopyableQuote.tsx";
import { replyBlock, runnableCode } from "./codeRunner.tsx";
import { linkMenu } from "./LinkMenu.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { ChangesPart } from "./parts/ChangesPart.tsx";
import { FilePart } from "./parts/FilePart.tsx";
import { ImageGenerationPreview } from "./parts/ImageGenerationPreview.tsx";
import { imageGenerationBlocks } from "./parts/imageGeneration.ts";
import { AudioPart } from "./parts/lazyAudio.tsx";
import type { MediaBlock } from "./parts/mediaGroups.ts";
import { NoticePart } from "./parts/NoticePart.tsx";
import { PlanPart } from "./parts/PlanPart.tsx";
import { SkillsPart } from "./parts/SkillsPart.tsx";
import { ToolGroup } from "./parts/ToolGroup.tsx";
import { planLast } from "./planLast.ts";
import { type ReplySegment, replySegments } from "./replySegments.ts";
import { taskCodeSpan } from "./TaskChip.tsx";

type ToolPart = Extract<Part, { type: "tool" }>;
type SkillsPick = Extract<Part, { type: "skills" }>;

/**
 * One agent message: the skills picked for it and its tool calls folded into one group on top, then everything else
 * in the order it happened (what it said, sub-agent cards, widgets, approvals, its answer). The meta line closes it.
 * Each bubble has its own controls (copy, fork, read aloud), shown on hover. Each block it wrote (code, a page, a
 * diagram, an email) is a card of its own between the bubbles of its words; their controls are on the last bubble.
 */
export function AgentTurn({
  thread,
  message,
  agent,
  showAvatar,
  showTools,
  showSkills = true,
  showPlan = true,
  generationImages,
  engine,
  actions,
}: {
  thread: Thread;
  message: Msg;
  agent?: Agent;
  showAvatar: boolean;
  showTools: boolean;
  /** The skills picked for the turn, as chips on top (a task's conversation leaves them out). */
  showSkills?: boolean;
  /** Whether its plan shows: a newer message's plan replaces it. */
  showPlan?: boolean;
  /** Result pictures from the same run, including messages split by an intervening owner reply. */
  generationImages?: Parameters<typeof imageGenerationBlocks>[3];
  /** An engine session: its answers are signed by the engine ("Codex"), not by the agent behind the run. */
  engine?: { id: string; label: string } | undefined;
  /** Extra controls for the whole answer (ask again), with the last bubble's. */
  actions?: ReactNode;
}) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
  const tools = showTools ? message.parts.filter((p): p is ToolPart => p.type === "tool") : [];
  const runState = useData((s) => (message.run_id ? s.runs[message.run_id]?.state : undefined));
  const waiting = runState === "input-required";
  const skills = showSkills ? message.parts.find((p): p is SkillsPick => p.type === "skills") : undefined;
  const projectId = useData((s) => s.threads[message.thread_id]?.project_id);
  // Pictures and videos side by side become one grid or one carousel; everything else is a block of its own.
  const blocks: {
    key: string;
    part: Part;
    media?: Exclude<MediaBlock, { kind: "part" }>;
    generation?: boolean;
  }[] = imageGenerationBlocks(
    message.parts,
    runState,
    (p) => p.type === "skills" || (p.type === "text" && (!p.text.trim() || isSignal(p.text))),
    generationImages,
  ).map((b) =>
    b.kind === "generation"
      ? { key: b.key, part: b.part, generation: true, ...(b.media ? { media: b.media } : {}) }
      : b.kind === "part"
        ? { key: b.part.type === "text" ? `x:${b.index}` : cardKey(b.part, b.index), part: b.part }
        : { key: b.key, part: b.parts[0] as Part, media: b },
  );
  const live = runState === "working" || runState === "submitted" || runState === "queued";
  // A text part's words, cut where a block draws something of its own; `whole` is the part's text, for its controls.
  const items: {
    key: string;
    part: Part;
    media?: Exclude<MediaBlock, { kind: "part" }>;
    segment?: ReplySegment;
    whole?: string;
    generation?: boolean;
  }[] = planLast(live, showPlan, blocks).flatMap((b) => {
    if (b.part.type !== "text" || b.media) return [b];
    const text = b.part.text;
    const segments = replySegments(text);
    const lastWords = segments.findLastIndex((n) => n.kind === "text");
    return segments.map((segment, j) => ({
      key: j === 0 ? b.key : `${b.key}:${j}`,
      part: b.part,
      segment,
      ...(j === lastWords ? { whole: text } : {}),
    }));
  });
  const avatar = !showAvatar ? undefined : engine ? (
    <EngineIcon engine={engine.id} size={24} />
  ) : agent ? (
    <button
      type="button"
      className="turn__agentbtn"
      aria-label={t("agent.openPanel", { name: agent.name })}
      onClick={() => go.agent(agent.id)}
    >
      <AgentAvatar name={agent.name} blob={blobOf(agent)} size={24} animated={false} />
    </button>
  ) : undefined;
  const [received, setReceived] = useState(false);
  // What the model was sent for this answer, beside the answer's own controls.
  const lookIn = message.run_id ? (
    <IconButton size="sm" label={t("msg.received")} icon={<Icons.Eye size={13} />} onClick={() => setReceived(true)} />
  ) : null;
  const catalog = useModels((s) => s.catalog);
  const reported = message.model ? splitRef(message.model) : undefined;
  const confirmed =
    message.model_reported === true && reported?.model && reported.model !== "default" ? message.model : undefined;
  const effort = engine ? undefined : reported?.effort;
  const model = engine
    ? confirmed
      ? (modelOf(confirmed, catalog)?.name ?? <code>{splitRef(confirmed).model}</code>)
      : t("chat.modelUnconfirmed")
    : message.model && baseRef(message.model);
  // The engine notes when the agent's own model did not answer and a fallback did (engine.fallback).
  const fellBack = message.parts.some((p) => p.type === "notice" && p.code === "engine.fallback");
  const meta = (
    <MessageMeta agent={engine?.label ?? agent?.name} model={model} effort={effort && effortLabel(effort)}>
      {fellBack && (
        <span className="apx-msgmeta__part" title={t("chat.modelFallbackHint")}>
          {t("chat.modelFallback")}
        </span>
      )}
      <ViaMark thread={thread} message={message} />
      {message.delivery && <DeliveryTicks state={message.delivery} />}
    </MessageMeta>
  );

  return (
    <div className="turn">
      {skills && <SkillsPart part={skills} projectId={projectId} />}
      {tools.length > 0 && <ToolGroup parts={tools} waiting={waiting} />}
      {items.map(({ key, part, media, segment, whole, generation }, i) => {
        if (generation) return <ImageGenerationPreview key={key} block={media} />;
        const last = i === items.length - 1;
        const card = segment?.kind === "block";
        const words = part.type === "text" && !card;
        return (
          <Message
            key={key}
            from="agent"
            variant={words ? "bubble" : "bare"}
            avatar={i === 0 ? avatar : undefined}
            grouped={i > 0}
            meta={last ? meta : undefined}
            reactions={
              last && message.reactions?.length ? (
                <ReactionList list={message.reactions} agentName={engine?.label ?? agent?.name ?? ""} />
              ) : undefined
            }
            actions={
              words && (whole !== undefined || !segment) ? (
                <MessageActions
                  thread={thread}
                  message={message}
                  text={whole ?? (part.type === "text" ? part.text : "")}
                  speechKey={`${message.id}:${key}`}
                >
                  {last && lookIn}
                  {last && actions}
                </MessageActions>
              ) : last ? (
                <>
                  {lookIn}
                  {actions}
                </>
              ) : undefined
            }
          >
            {media ? (
              <Suspense fallback={null}>
                <MediaGroup block={media} />
              </Suspense>
            ) : segment?.kind === "block" ? (
              <div className="apx-md apx-md--md turn__card">
                {replyBlock(thread, message.id, segment, segment.open && live)}
              </div>
            ) : part.type === "text" ? (
              <MarkdownView
                labels={mdLabels}
                source={segment?.kind === "text" ? segment.text : part.text}
                renderLink={linkMenu}
                renderCode={runnableCode(thread, message.id)}
                renderQuote={copyableQuote}
                renderCodeSpan={taskCodeSpan}
              />
            ) : (
              renderCard(part, agent, message)
            )}
          </Message>
        );
      })}
      {received && message.run_id && (
        <Suspense fallback={null}>
          <ReceivedDialog run={message.run_id} onClose={() => setReceived(false)} />
        </Suspense>
      )}
    </div>
  );
}

function cardKey(p: Part, i: number): string {
  if (p.type === "surface") return `s:${p.surface_id}`;
  if (p.type === "subthread") return `t:${p.thread_id}`;
  if (p.type === "browser") return `b:${p.tab}`;
  if (p.type === "input") return `i:${p.input_id}`;
  if (p.type === "flow") return `f:${p.flow}`;
  if (p.type === "plan") return "plan";
  return `${p.type}:${i}`;
}

function renderCard(p: Part, agent: Agent | undefined, message: Msg): ReactNode {
  switch (p.type) {
    case "surface":
      return (
        <Suspense fallback={null}>
          <SurfacePart part={p} />
        </Suspense>
      );
    case "subthread":
      return (
        <Suspense fallback={<span>{p.summary ?? p.title}</span>}>
          <SubthreadPart part={p} from={agent} />
        </Suspense>
      );
    case "browser":
      return (
        <Suspense fallback={null}>
          <BrowserPart part={p} agent={agent} threadId={message.thread_id} />
        </Suspense>
      );
    case "image":
      // One with a source is in its message's picture grid; one without has nothing to show.
      return null;
    case "file":
      return <FilePart part={p} />;
    case "audio":
      return <AudioPart part={p} />;
    case "notice":
      return <NoticePart part={p} />;
    case "plan":
      return <PlanPart part={p} />;
    case "input":
      return (
        <Suspense fallback={null}>
          <InputPart part={p} />
        </Suspense>
      );
    case "changes":
      return <ChangesPart part={p} />;
    case "choices":
      return (
        <Suspense fallback={null}>
          <ChoicesPart part={p} threadId={message.thread_id} messageId={message.id} agentId={agent?.id} />
        </Suspense>
      );
    case "connect":
      return (
        <Suspense fallback={null}>
          <ConnectPart part={p} threadId={message.thread_id} messageId={message.id} />
        </Suspense>
      );
    case "flow":
      return (
        <Suspense fallback={null}>
          <FlowCard part={p} />
        </Suspense>
      );
    default:
      return null;
  }
}
