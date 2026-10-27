import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon, Tooltip } from "@apx/ui";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS } from "../channels/kinds.ts";
import { AgentFace } from "../common/AgentFace.tsx";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useThreadChannel } from "./useThreadChannel.ts";

/** Keep the avatar column aligned; a delegated session shows its recipient with its caller as a small badge. */
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
  const channel = useThreadChannel(thread);
  const channelLabel = channel ? t("chat.viaChannel", { channel: t(CHANNEL_KINDS[channel].name) }) : "";
  const markSize = Math.min(16, size);
  const width = slot + (channel ? markSize + 4 : 0);
  const agents = useShownAgents();
  const parent = useData((s) => (thread.parent_id ? s.threads[thread.parent_id] : undefined));
  const caller = agents[parent?.agent_ids[0] ?? ""];
  const group = thread.kind === "group";
  const badge = !group && thread.kind === "a2a" && caller && caller.id !== agent?.id ? caller : undefined;
  const faces = group ? thread.agent_ids.slice(0, 2).map((id) => agents[id]) : [agent];
  return (
    <span className="threadavatar" style={{ width, minWidth: width, height: slot, gap: 4 }}>
      {channel && (
        <Tooltip content={channelLabel}>
          <span
            className="threadavatar__channel"
            role="img"
            aria-label={channelLabel}
            style={{ display: "inline-flex" }}
          >
            <KindIcon kind={channel} size={markSize} />
          </span>
        </Tooltip>
      )}
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
              <AgentAvatar name={thread.title} size={size} animated={false} />
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
