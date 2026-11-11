import type { Agent } from "@apx/protocol";
import { AgentAvatar, IconButton, Popover } from "@apx/ui";
import { Suspense, useRef, useState } from "react";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AgentEditor, SuperAgentCard } from "../lazy.ts";
import { go } from "./nav.ts";

/**
 * The super-agent in the top bar. A click (or ⌘J) opens its chat; resting on it shows its card: what it and the agents
 * it delegated to are doing now, its last message, and a way to edit it.
 */
export function SuperAgentButton({ agent }: { agent: Agent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // The click that opens the chat must not also leave the card pinned open.
  const pressed = useRef(false);
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
        openOnHover
        open={open}
        onOpenChange={(next) => {
          if (next && pressed.current) return;
          setOpen(next);
        }}
        label={agent.name}
        trigger={
          <IconButton
            className="topbar__agent"
            size="sm"
            label={t("roby.openHint", { name: agent.name })}
            tooltip={false}
            onClick={() => {
              pressed.current = true;
              setTimeout(() => {
                pressed.current = false;
              }, 0);
              openChat();
            }}
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
