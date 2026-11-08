import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, IconButton, Icons, Menu, Popover } from "@apx/ui";
import { Suspense, useMemo, useRef, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AgentEditor } from "../lazy.ts";
import { go } from "./nav.ts";
import { lastAgentWords, superAgentNow } from "./superAgentNow.ts";

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

function SuperAgentCard({
  agent,
  homeId,
  onOpenChat,
  onEdit,
  onClose,
}: {
  agent: Agent;
  homeId: string | undefined;
  onOpenChat: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const messages = useData((s) => (homeId ? s.messages[homeId] : undefined));
  const now = useMemo(() => superAgentNow(threads, agent.id), [threads, agent.id]);
  const last = lastAgentWords(homeId ? threads[homeId] : undefined, messages);
  const more = [
    {
      label: t("agent.openPanel", { name: agent.name }),
      icon: <Icons.PanelRight />,
      disabled: !homeId,
      onSelect: () => {
        onClose();
        if (homeId) go.inboxThread(homeId);
        go.agent(agent.id);
      },
    },
    {
      label: t("agent.super.profile"),
      icon: <Icons.Calendar />,
      onSelect: () => {
        onClose();
        go.config("profile");
      },
    },
    {
      label: t("agent.super.owner"),
      icon: <Icons.User />,
      onSelect: () => {
        onClose();
        go.config("account");
      },
    },
  ];
  return (
    <div className="superagent__card">
      <div className="superagent__head">
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={40} />
        <div className="superagent__who">
          <div className="superagent__name">{agent.name}</div>
          <div className="superagent__role">{t("roby.role")}</div>
        </div>
        {now.length > 0 && (
          <span className="superagent__working">
            <span aria-hidden="true" />
            {t("roby.working")}
          </span>
        )}
        <Menu
          align="end"
          items={more}
          trigger={<IconButton size="sm" label={t("topbar.more")} icon={<Icons.Ellipsis size={14} />} />}
        />
      </div>
      <div className="superagent__now">
        <div className="superagent__label">{t("roby.now")}</div>
        {now.length ? (
          now.map((row) => {
            const who = row.agentId ? agents[row.agentId] : undefined;
            return (
              <div className="superagent__row" key={row.threadId}>
                <AgentAvatar name={who?.name ?? agent.name} blob={blobOf(who)} size={20} animated={false} />
                <span className="superagent__text">{row.text}</span>
                <span className="superagent__project">{projectName(projects, row.projectId)}</span>
              </div>
            );
          })
        ) : (
          <div className="superagent__idle">{t("roby.idle")}</div>
        )}
      </div>
      <div className="superagent__last">
        <div className="superagent__label">
          <span>{t("roby.lastMessage")}</span>
          {last && <span>{shortWhen(last.at)}</span>}
        </div>
        <div className="superagent__words">{last?.text ?? t("roby.noMessage")}</div>
      </div>
      <div className="superagent__actions">
        <Button
          className="superagent__open"
          disabled={!homeId}
          onClick={onOpenChat}
          trailingIcon={
            <span className="superagent__kbd" data-shortcut-modifier>
              ⌘J
            </span>
          }
        >
          {t("roby.openChat")}
        </Button>
        <Button
          variant="secondary"
          leadingIcon={<Icons.Pencil size={14} />}
          title={t("roby.editHint", { name: agent.name })}
          onClick={onEdit}
        >
          {t("roby.edit")}
        </Button>
      </div>
    </div>
  );
}
