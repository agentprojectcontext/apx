import type { Agent, Message as Msg, Part } from "@apx/protocol";
import { AgentAvatar, EngineIcon, MarkdownView, Message, MessageMeta } from "@apx/ui";
import type { ReactNode } from "react";
import { blobOf } from "../data/identity.ts";
import { baseRef, effortLabel, splitRef } from "../data/models.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { AudioPart } from "./parts/AudioPart.tsx";
import { BrowserPart } from "./parts/BrowserPart.tsx";
import { ChangesPart } from "./parts/ChangesPart.tsx";
import { ImagePart } from "./parts/ImagePart.tsx";
import { InputPart } from "./parts/InputPart.tsx";
import { NoticePart } from "./parts/NoticePart.tsx";
import { SkillsPart } from "./parts/SkillsPart.tsx";
import { SubthreadPart } from "./parts/SubthreadPart.tsx";
import { SurfacePart } from "./parts/SurfacePart.tsx";
import { ToolGroup } from "./parts/ToolGroup.tsx";

type ToolPart = Extract<Part, { type: "tool" }>;
type SkillsPick = Extract<Part, { type: "skills" }>;

/**
 * One agent message: the skills picked for it and its tool calls folded into one group on top, then everything else
 * in the order it happened (what it said, sub-agent cards, widgets, approvals, its answer). The meta line closes it.
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
  const t = useT();
  const tools = showTools ? message.parts.filter((p): p is ToolPart => p.type === "tool") : [];
  const waiting = useData((s) => (message.run_id ? s.runs[message.run_id]?.state === "input-required" : false));
  const skills = message.parts.find((p): p is SkillsPick => p.type === "skills");
  const projectId = useData((s) => s.threads[message.thread_id]?.project_id);
  const blocks: { key: string; part: Part }[] = message.parts.flatMap((p, i) =>
    p.type === "tool" || p.type === "skills" || (p.type === "text" && !p.text.trim())
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
    />
  );

  return (
    <div className="turn">
      {skills && <SkillsPart part={skills} projectId={projectId} />}
      {tools.length > 0 && <ToolGroup parts={tools} waiting={waiting} />}
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
