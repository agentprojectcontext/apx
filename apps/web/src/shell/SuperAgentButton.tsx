import type { Agent } from "@apx/protocol";
import { AgentAvatar, IconButton, Popover } from "@apx/ui";
import { Suspense, useState } from "react";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { AgentEditor, SuperAgentCard } from "../lazy.ts";
import { go } from "./nav.ts";

/**
 * The super-agent in the top bar. A click opens its card: what it and the agents it delegated to are doing now, its
 * last message, and a way to edit it. ⌘J and the chat button beside it open its chat.
 */
export function SuperAgentButton({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const homeId = useData((s) => Object.values(s.threads).find((x) => x.kind === "home")?.id);
  const openChat = () => {
    setOpen(false);
    if (homeId) go.inboxThread(homeId);
  };
  return (
    <>
      <Popover
        align="end"
        width={340}
        className="superagent"
        open={open}
        onOpenChange={setOpen}
        label={agent.name}
        trigger={
          <IconButton
            className="topbar__agent"
            size="sm"
            label={agent.name}
            tooltip={false}
            icon={
              <>
                <AgentAvatar name={agent.name} blob={blobOf(agent)} size={24} />
                <span className="topbar__agentname">{agent.name}</span>
                <span className="topbar__agentkbd" data-shortcut-modifier>
                  ⌘J
                </span>
              </>
            }
          />
        }
      >
        {open && (
          <Suspense fallback={null}>
            <SuperAgentCard
              agent={agent}
              homeId={homeId}
              onOpenChat={openChat}
              onEdit={() => {
                setOpen(false);
                setEditing(true);
              }}
              onClose={() => setOpen(false)}
            />
          </Suspense>
        )}
      </Popover>
      {editing && (
        <Suspense fallback={null}>
          <AgentEditor agent={agent} onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </>
  );
}
