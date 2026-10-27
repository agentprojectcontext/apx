import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon } from "@apx/ui";
import { Suspense } from "react";
import { AgentFace } from "../common/AgentFace.tsx";
import { useData, useShownAgents } from "../data/state.ts";
import { ChannelFace } from "../lazy.ts";

/** Keep the avatar column aligned; a delegated session shows its recipient with its caller as a small badge. */
export function ThreadAvatar({
  thread,
  agent,
  size,
  slot = size,
  editable = false,
  online = false,
  animated,
  channelMark = false,
}: {
  thread: Thread;
  agent: Agent | undefined;
  size: number;
  slot?: number;
  editable?: boolean;
  online?: boolean;
  animated?: boolean;
  channelMark?: boolean;
}) {
  const agents = useShownAgents();
  const parent = useData((s) => (thread.parent_id ? s.threads[thread.parent_id] : undefined));
  const caller = agents[parent?.agent_ids[0] ?? ""];
  const group = thread.kind === "group";
  const badge = !group && thread.kind === "a2a" && caller && caller.id !== agent?.id ? caller : undefined;
  const faces = group ? thread.agent_ids.slice(0, 2).map((id) => agents[id]) : [agent];
  const fallback = <AgentAvatar name={thread.title} size={size} animated={false} />;
  if (thread.channel)
    return (
      <Suspense fallback={fallback}>
        <ChannelFace thread={thread} size={size} slot={slot} showMark={channelMark} />
      </Suspense>
    );
  return (
    <span className="threadavatar" style={{ width: slot, minWidth: slot, height: slot, gap: 4 }}>
      {thread.engine ? (
        <EngineIcon engine={thread.engine} tile size={size} />
      ) : (
        faces.map((face, i) => (
          <span key={face?.id ?? i} className={group && i > 0 ? "threadavatar__group" : undefined}>
            {face ? (
              <AgentFace
                agent={face}
                size={group ? slot : size}
                editable={editable}
                online={online}
                animated={animated}
              />
            ) : (
              fallback
            )}
          </span>
        ))
      )}
      {badge && (
        <span className="threadavatar__caller">
          <AgentFace agent={badge} size={Math.max(10, Math.round(size * 0.5))} editable={editable} />
        </span>
      )}
    </span>
  );
}
