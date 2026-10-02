import type { Agent, Message as Msg, Part } from "@apx/protocol";
import { AgentAvatar, EngineIcon, MarkdownView, Message, MessageMeta } from "@apx/ui";
import type { ReactNode } from "react";
import { blobOf } from "../data/identity.ts";
import { AudioPart } from "./parts/AudioPart.tsx";
import { BrowserPart } from "./parts/BrowserPart.tsx";
import { ChangesPart } from "./parts/ChangesPart.tsx";
import { ImagePart } from "./parts/ImagePart.tsx";
import { InputPart } from "./parts/InputPart.tsx";
import { NoticePart } from "./parts/NoticePart.tsx";
import { SubthreadPart } from "./parts/SubthreadPart.tsx";
import { SurfacePart } from "./parts/SurfacePart.tsx";
import { ToolGroup } from "./parts/ToolGroup.tsx";

type ToolPart = Extract<Part, { type: "tool" }>;

/**
 * One agent message, in the design's order: tool calls folded into one group, sub-agent cards, the text,
 * then the rest of the cards (browser, widgets, images). The meta line closes the turn.
 */
export function AgentTurn({
  message,
  agent,
  showAvatar,
  showTools,
  engine,
}: {
  message: Msg;
  agent?: Agent;
  showAvatar: boolean;
  showTools: boolean;
  /** An engine session: its answers are signed by the engine ("Codex"), not by the agent behind the run. */
  engine?: { id: string; label: string } | undefined;
}) {
  const tools = showTools ? message.parts.filter((p): p is ToolPart => p.type === "tool") : [];
  const subs = message.parts.filter((p) => p.type === "subthread");
  const texts = message.parts.filter((p) => p.type === "text" && p.text.trim());
  const rest = message.parts.filter((p) => p.type !== "text" && p.type !== "tool" && p.type !== "subthread");
  const blocks: { key: string; part: Part }[] = [
    ...subs.map((p, i) => ({ key: cardKey(p, i), part: p })),
    ...texts.map((p, i) => ({ key: `x:${i}`, part: p })),
    ...rest.map((p, i) => ({ key: cardKey(p, i), part: p })),
  ];
  const avatar = !showAvatar ? undefined : engine ? (
    <EngineIcon engine={engine.id} size={24} />
  ) : agent ? (
    <AgentAvatar name={agent.name} blob={blobOf(agent)} size={24} animated={false} />
  ) : undefined;
  const meta = <MessageMeta agent={engine?.label ?? agent?.name} model={message.model} />;

  return (
    <div className="turn">
      {tools.length > 0 && <ToolGroup parts={tools} />}
      {blocks.map(({ key, part }, i) => (
        <Message
          key={key}
          from="agent"
          variant={part.type === "text" ? "bubble" : "bare"}
          avatar={i === 0 ? avatar : undefined}
          grouped={i > 0}
          meta={i === blocks.length - 1 ? meta : undefined}
        >
          {part.type === "text" ? <MarkdownView source={part.text} /> : renderCard(part, agent)}
        </Message>
      ))}
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

function renderCard(p: Part, agent: Agent | undefined): ReactNode {
  switch (p.type) {
    case "surface":
      return <SurfacePart part={p} />;
    case "subthread":
      return <SubthreadPart part={p} from={agent} />;
    case "browser":
      return <BrowserPart part={p} agent={agent} />;
    case "image":
      return <ImagePart part={p} />;
    case "audio":
      return <AudioPart part={p} />;
    case "notice":
      return <NoticePart part={p} />;
    case "input":
      return <InputPart part={p} />;
    case "changes":
      return <ChangesPart part={p} />;
    default:
      return null;
  }
}
