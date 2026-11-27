import type { Agent, Message as Msg, Part, Thread } from "@apx/protocol";
import {
  AgentAvatar,
  EngineIcon,
  IconButton,
  Icons,
  type LinkRenderer,
  MarkdownView,
  Message,
  MessageMeta,
  Tooltip,
} from "@apx/ui";
import { type ReactNode, Suspense, useState } from "react";
import { DeliveryTicks, ReactionList, ViaMark } from "../channels/MessageMarks.tsx";
import { isSignal, isSkipAnswer } from "../channels/signal.ts";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { blobOf } from "../data/identity.ts";
import { baseRef, effortLabel, modelOf, splitRef, useModels } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import {
  BrowserPart,
  ChangesPart,
  ChoicesPart,
  ConnectPart,
  FlowCard,
  ImageGenerationPreview,
  InputPart,
  MediaGroup,
  MessageLink,
  NoticePart,
  ReceivedDialog,
  SkillsPart,
  SubthreadPart,
  SurfacePart,
  WorkflowPart,
} from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { copyableQuote } from "./CopyableQuote.tsx";
import { replyBlock, runnableCode } from "./codeRunner.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { AutoDecisionLine } from "./parts/AutoDecisionLine.tsx";
import { chipFold, isChip } from "./parts/chips.ts";
import { FilePart } from "./parts/FilePart.tsx";
import { imageGenerationBlocks } from "./parts/imageGeneration.ts";
import { AudioPart } from "./parts/lazyAudio.tsx";
import type { MediaBlock } from "./parts/mediaGroups.ts";
import { PlanPart } from "./parts/PlanPart.tsx";
import { ToolGroup } from "./parts/ToolGroup.tsx";
import { planLast } from "./planLast.ts";
import { QuietMark } from "./QuietMark.tsx";
import { type ReplySegment, replySegments } from "./replySegments.ts";
import { runEnded } from "./runEnded.ts";
import { Speaker } from "./Speaker.tsx";
import { taskCodeSpan } from "./TaskChip.tsx";

/** A message's links show as written until their menus load (lazy.ts), then gain them. */
const linkMenu: LinkRenderer = (href, link) => (
  <Suspense fallback={/^apx:/i.test(href) ? (link.props as { children?: ReactNode }).children : link}>
    <MessageLink href={href} link={link} />
  </Suspense>
);

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
  // A note saved or research updated is a chip of its own, not a step (chips.ts).
  const chips = chipFold(message.parts);
  const tools = showTools
    ? message.parts.filter((p): p is ToolPart => p.type === "tool" && !chips.calls.has(p.call_id))
    : [];
  const runState = useData((s) => (message.run_id ? s.runs[message.run_id]?.state : undefined));
  const waiting = runState === "input-required";
  const ended = runEnded(runState);
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
    (p) => p.type === "skills" || chips.later.has(p) || (p.type === "text" && (!p.text.trim() || isSignal(p.text))),
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
  // With its face and name over the turn (a chat with several speakers), the meta line leaves the name out.
  const meta = (
    <MessageMeta
      agent={avatar ? undefined : (engine?.label ?? agent?.name)}
      model={model}
      effort={effort && effortLabel(effort)}
    >
      {fellBack && (
        <Tooltip content={t("chat.modelFallbackHint")}>
          <span className="apx-msgmeta__part">{t("chat.modelFallback")}</span>
        </Tooltip>
      )}
      <ViaMark thread={thread} message={message} />
      {message.delivery && <DeliveryTicks state={message.delivery} />}
    </MessageMeta>
  );

  // The chips label an answer: a finished turn that said nothing (a mail it let pass, a signal) shows nothing at all,
  // but for SKIP, which says there was nothing worth telling.
  if (!live && tools.length === 0 && items.length === 0) {
    if (!message.parts.some((p) => p.type === "text" && isSkipAnswer(p.text))) return null;
    return (
      <div className="turn">
        <QuietMark />
      </div>
    );
  }
  // The turn's words when it ends in a card rather than in words; undefined otherwise.
  const lastItem = items.at(-1);
  const endsInCard = items.length > 1 && !(lastItem?.part.type === "text" && lastItem.segment?.kind !== "block");
  const tail = endsInCard
    ? items
        .filter((it) => it.part.type === "text" && it.segment?.kind !== "block")
        .map((it) => (it.segment?.kind === "text" ? it.segment.text : it.part.type === "text" ? it.part.text : ""))
        .join("\n\n")
        .trim() || undefined
    : undefined;
  return (
    <div className="turn">
      {avatar && <Speaker face={avatar} name={engine?.label ?? agent?.name} />}
      {skills && (
        <Suspense fallback={null}>
          <SkillsPart part={skills} projectId={projectId} />
        </Suspense>
      )}
      {tools.length > 0 && <ToolGroup parts={tools} waiting={waiting} ended={ended} />}
      {/* What waited for the owner shows as its card, not as a line. */}
      {tools.map(
        (p) =>
          p.auto_decision?.verdict === "run" && <AutoDecisionLine key={`auto:${p.call_id}`} note={p.auto_decision} />,
      )}
      {items.map(({ key, part, media, segment, whole, generation }, i) => {
        if (generation)
          return (
            <Suspense key={key} fallback={null}>
              <ImageGenerationPreview block={media} />
            </Suspense>
          );
        const last = i === items.length - 1;
        const card = segment?.kind === "block";
        const words = part.type === "text" && !card;
        // Words followed by a card (a greeting with choices): their controls go to the turn's last line, beside the
        // name, instead of an empty row of their own between the words and the card.
        const controls = tail ? last : words && (whole !== undefined || !segment);
        return (
          <Message
            key={key}
            from="agent"
            variant={words ? "bubble" : "bare"}
            grouped={i > 0}
            meta={last ? meta : undefined}
            reactions={
              last && message.reactions?.length ? (
                <ReactionList list={message.reactions} agentName={engine?.label ?? agent?.name ?? ""} />
              ) : undefined
            }
            actions={
              controls ? (
                <MessageActions
                  thread={thread}
                  message={message}
                  text={tail ?? whole ?? (part.type === "text" ? part.text : "")}
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
              renderCard(part, agent, message, ended)
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
  if (p.type === "workflow") return `w:${p.workflow_id}`;
  return `${p.type}:${i}`;
}

function renderCard(p: Part, agent: Agent | undefined, message: Msg, ended: boolean): ReactNode {
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
      return (
        // A chip's few words arrive with it; a notice's own text stands in for it while it loads.
        <Suspense fallback={isChip(p) ? null : p.text}>
          <NoticePart part={p} parts={message.parts} />
        </Suspense>
      );
    case "plan":
      return <PlanPart part={p} ended={ended} />;
    case "workflow":
      return (
        <Suspense fallback={<span>{p.name}</span>}>
          <WorkflowPart part={p} />
        </Suspense>
      );
    case "input":
      return (
        <Suspense fallback={null}>
          <InputPart part={p} />
        </Suspense>
      );
    case "changes":
      return (
        <Suspense fallback={null}>
          <ChangesPart part={p} />
        </Suspense>
      );
    case "choices":
      return (
        <Suspense fallback={null}>
          <ChoicesPart part={p} threadId={message.thread_id} messageId={message.id} agentId={agent?.id} />
        </Suspense>
      );
    case "connect":
      return (
        <Suspense fallback={null}>
          <ConnectPart part={p} />
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
