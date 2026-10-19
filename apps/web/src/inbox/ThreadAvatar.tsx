import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";

/** Keep the avatar column aligned; a delegated session shows its recipient with its caller as a small badge. */
export function ThreadAvatar({
  thread,
  agent,
  size,
  slot = size,
}: {
  thread: Thread;
  agent: Agent | undefined;
  size: number;
  slot?: number;
}) {
  const agents = useShownAgents();
  const parent = useData((s) => (thread.parent_id ? s.threads[thread.parent_id] : undefined));
  const caller = agents[parent?.agent_ids[0] ?? ""];
  const group = thread.kind === "group";
  const badge = !group && thread.kind === "a2a" && caller && caller.id !== agent?.id ? caller : undefined;
  const faces = group ? thread.agent_ids.slice(0, 2).map((id) => agents[id]) : [agent];
  return (
    <span className="threadavatar" style={{ width: slot, minWidth: slot, height: slot }}>
      {thread.engine ? (
        <EngineIcon engine={thread.engine} tile size={size} />
      ) : (
        faces.map((face, i) => (
          <span key={face?.id ?? i} className={group && i > 0 ? "threadavatar__group" : undefined}>
            <AgentAvatar
              name={face?.name ?? thread.title}
              blob={blobOf(face)}
              size={group ? slot : size}
              animated={false}
            />
          </span>
        ))
      )}
      {badge && (
        <span className="threadavatar__caller" title={badge.name}>
          <AgentAvatar
            name={badge.name}
            blob={blobOf(badge)}
            size={Math.max(10, Math.round(size * 0.5))}
            animated={false}
          />
        </span>
      )}
    </span>
  );
}
