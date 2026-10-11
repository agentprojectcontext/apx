import type { Agent, Message as Msg, Part, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon, MarkdownView, Message, MessageMeta } from "@apx/ui";
import { lazy, type ReactNode, Suspense } from "react";
import { DeliveryTicks, ReactionList } from "../channels/MessageMarks.tsx";
import { isSignal } from "../channels/signal.ts";
import { blobOf } from "../data/identity.ts";
import { baseRef, effortLabel, splitRef } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { linkMenu } from "./LinkMenu.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { AudioPart } from "./parts/AudioPart.tsx";
import { BrowserPart } from "./parts/BrowserPart.tsx";
import { ChangesPart } from "./parts/ChangesPart.tsx";
import { FilePart } from "./parts/FilePart.tsx";
import { ImagePart } from "./parts/ImagePart.tsx";
import { NoticePart } from "./parts/NoticePart.tsx";
import { SkillsPart } from "./parts/SkillsPart.tsx";
import { SubthreadPart } from "./parts/SubthreadPart.tsx";
import { ToolGroup } from "./parts/ToolGroup.tsx";
import { runnableCode } from "./RunnableCode.tsx";

// A widget's frame loads with the first message that has one, not with the chat.
const SurfacePart = lazy(() => import("./parts/SurfacePart.tsx").then((m) => ({ default: m.SurfacePart })));
const ChoicesPart = lazy(() => import("./parts/ChoicesPart.tsx").then((m) => ({ default: m.ChoicesPart })));
const InputPart = lazy(() => import("./parts/InputPart.tsx").then((m) => ({ default: m.InputPart })));

type ToolPart = Extract<Part, { type: "tool" }>;
type SkillsPick = Extract<Part, { type: "skills" }>;

/**
 * One agent message: the skills picked for it and its tool calls folded into one group on top, then everything else
 * in the order it happened (what it said, sub-agent cards, widgets, approvals, its answer). The meta line closes it.
 * Each bubble has its own controls (copy, fork, read aloud), shown on hover.
 */
export function AgentTurn({
  thread,
  message,
  agent,
  showAvatar,
  showTools,
  showSkills = true,
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
  /** An engine session: its answers are signed by the engine ("Codex"), not by the agent behind the run. */
  engine?: { id: string; label: string } | undefined;
  /** Extra controls for the whole answer (ask again), with the last bubble's. */
  actions?: ReactNode;
}) {
  const t = useT();
  const tools = showTools ? message.parts.filter((p): p is ToolPart => p.type === "tool") : [];
  const waiting = useData((s) => (message.run_id ? s.runs[message.run_id]?.state === "input-required" : false));
  const skills = showSkills ? message.parts.find((p): p is SkillsPick => p.type === "skills") : undefined;
  const projectId = useData((s) => s.threads[message.thread_id]?.project_id);
  const blocks: { key: string; part: Part }[] = message.parts.flatMap((p, i) =>
    p.type === "tool" || p.type === "skills" || (p.type === "text" && (!p.text.trim() || isSignal(p.text)))
      ? []
      : [{ key: p.type === "text" ? `x:${i}` : cardKey(p, i), part: p }],
  );
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
  const effort = message.model ? splitRef(message.model).effort : undefined;
  const meta = (
    <MessageMeta
      agent={engine?.label ?? agent?.name}
      model={message.model && baseRef(message.model)}
      effort={effort && effortLabel(effort)}
    >
      {message.delivery && <DeliveryTicks state={message.delivery} />}
    </MessageMeta>
  );

  return (
    <div className="turn">
      {skills && <SkillsPart part={skills} projectId={projectId} />}
      {tools.length > 0 && <ToolGroup parts={tools} waiting={waiting} />}
      {blocks.map(({ key, part }, i) => {
        const last = i === blocks.length - 1;
        return (
          <Message
            key={key}
            from="agent"
            variant={part.type === "text" ? "bubble" : "bare"}
            avatar={i === 0 ? avatar : undefined}
            grouped={i > 0}
            meta={last ? meta : undefined}
            reactions={
              last && message.reactions?.length ? (
                <ReactionList list={message.reactions} agentName={engine?.label ?? agent?.name ?? ""} />
              ) : undefined
            }
            actions={
              part.type === "text" ? (
                <MessageActions thread={thread} message={message} text={part.text} speechKey={`${message.id}:${key}`}>
                  {last && actions}
                </MessageActions>
              ) : last ? (
                actions
              ) : undefined
            }
          >
            {part.type === "text" ? (
              <MarkdownView source={part.text} renderLink={linkMenu} renderCode={runnableCode(thread, message.id)} />
            ) : (
              renderCard(part, agent, message)
            )}
          </Message>
        );
      })}
    </div>
  );
}

function cardKey(p: Part, i: number): string {
  if (p.type === "surface") return `s:${p.surface_id}`;
  if (p.type === "subthread") return `t:${p.thread_id}`;
  if (p.type === "browser") return `b:${p.tab}`;
  if (p.type === "input") return `i:${p.input_id}`;
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
      return <SubthreadPart part={p} from={agent} />;
    case "browser":
      return <BrowserPart part={p} agent={agent} />;
    case "image":
      return <ImagePart part={p} />;
    case "file":
      return <FilePart part={p} />;
    case "audio":
      return <AudioPart part={p} />;
    case "notice":
      return <NoticePart part={p} />;
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
    default:
      return null;
  }
}
