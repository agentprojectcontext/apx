import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon, Icons, Tooltip } from "@apx/ui";
import { Suspense } from "react";
import { AgentFace } from "../common/AgentFace.tsx";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ChannelFace } from "../lazy.ts";

/**
 * Keep the avatar column aligned; a delegated session shows its recipient with its caller as a small badge, a call the
 * agent called with a small phone. A helper
 * has no face of its own: a helper mark, with the agent that started it as the badge.
 */
export function ThreadAvatar({
  thread,
  agent,
  size,
  slot = size,
  editable = false,
  online = false,
  animated,
}: {
  thread: Thread;
  agent: Agent | undefined;
  size: number;
  slot?: number;
  editable?: boolean;
  online?: boolean;
  animated?: boolean;
}) {
  const t = useT();
  const agents = useShownAgents();
  const parent = useData((s) => (thread.parent_id ? s.threads[thread.parent_id] : undefined));
  const caller = agents[parent?.agent_ids[0] ?? ""];
  const group = thread.kind === "group";
  const helper = Boolean(thread.worker) && !group;
  const badge = helper
    ? agent
    : !group && thread.kind === "a2a" && caller && caller.id !== agent?.id
      ? caller
      : undefined;
  const faces = group ? thread.agent_ids.slice(0, 2).map((id) => agents[id]) : [agent];
  const fallback = <AgentAvatar name={thread.title} size={size} animated={false} />;
  if (thread.channel)
    return (
      <Suspense fallback={fallback}>
        <ChannelFace thread={thread} size={size} slot={slot} />
      </Suspense>
    );
  return (
    <span className="threadavatar" style={{ width: slot, minWidth: slot, height: slot, gap: 4 }}>
      {thread.engine ? (
        <EngineIcon engine={thread.engine} tile size={size} />
      ) : thread.kind === "call" && !agent ? (
        <span className="threadavatar__call" style={{ width: size, height: size }}>
          <Icons.Phone size={Math.round(size * 0.55)} />
        </span>
      ) : helper ? (
        <Tooltip content={t("subthread.worker")}>
          <span className="threadavatar__helper" style={{ width: size, height: size }}>
            <Icons.Bot size={Math.round(size * 0.6)} />
          </span>
        </Tooltip>
      ) : (
        faces.map((face, i) => (
          <span key={face?.id ?? i} className={group ? `threadavatar__group is-${i}` : undefined}>
            {face ? (
              <AgentFace
                agent={face}
                // A group's two faces share the slot, one up and left, the other down and right.
                size={group ? Math.round(slot * 0.66) : size}
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
      {/* A call shows who was called, with a phone on it. */}
      {thread.kind === "call" && agent && (
        <span
          className="threadavatar__callmark"
          style={{ width: Math.max(10, Math.round(size * 0.5)), height: Math.max(10, Math.round(size * 0.5)) }}
        >
          <Icons.Phone size={Math.max(6, Math.round(size * 0.3))} />
        </span>
      )}
      {badge && (
        <span className="threadavatar__caller">
          <AgentFace agent={badge} size={Math.max(10, Math.round(size * 0.5))} editable={editable} />
        </span>
      )}
    </span>
  );
}
