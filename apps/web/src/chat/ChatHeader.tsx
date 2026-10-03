import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, EngineIcon, IconButton, Icons, Menu, ProjectTile, Tag } from "@apx/ui";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { compactThread } from "../data/actions.ts";
import { blobOf, DEFAULT_PID, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";

export function ChatHeader({
  thread,
  agent,
  wide,
  compact = false,
}: {
  thread: Thread;
  agent: Agent | undefined;
  wide: boolean;
  /** Phone width: a back button returns to the chat list. */
  compact?: boolean;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const project = projects.find((p) => p.id === thread.project_id);
  const tools = useNav((s) => s.tools);
  const sub = thread.kind === "a2a" || thread.parent_id != null;
  // An engine session is the engine itself: its name and icon, not the agent that owns the run.
  const engine = useEngineLabel(thread.engine);
  const name = sub ? thread.title : (engine ?? agent?.name ?? thread.title);
  const via = thread.channel?.id ?? "";
  const channelLabel = isChannelKind(via) ? t(CHANNEL_KINDS[via].name) : via;

  return (
    <header className={compact ? "chat__header chat__header--compact" : "chat__header"}>
      {compact && !(sub && thread.parent_id) && (
        <IconButton size="sm" label={t("chat.toList")} icon={<Icons.ArrowLeft size={14} />} onClick={go.showList} />
      )}
      {sub && thread.parent_id && (
        <IconButton
          label={t("chat.back")}
          size="sm"
          icon={<Icons.ArrowLeft size={14} />}
          onClick={() => thread.parent_id && go.thread(thread.parent_id)}
        />
      )}
      {thread.engine ? (
        <EngineIcon engine={thread.engine} tile size={32} />
      ) : (
        <AgentAvatar
          name={agent?.name ?? name}
          blob={blobOf(agent)}
          size={32}
          status={sub ? undefined : "online"}
          statusLabel={t("presence.online")}
        />
      )}
      <div className="chat__titles">
        <div className="chat__title">
          <span className="chat__name">{name}</span>
          {engine && <Tag kind="role">{t("engine.direct")}</Tag>}
          {!sub && !engine && agent?.kind === "secretary" && <Tag kind="role">{t("agent.super")}</Tag>}
          {!sub && !engine && agent && agent.kind !== "secretary" && agent.role && <Tag kind="role">{agent.role}</Tag>}
        </div>
        <div className="chat__crumb">
          <ProjectTile tone={projectTone(project?.id ?? DEFAULT_PID)} size={12} />
          <span>{projectName(projects, thread.project_id)}</span>
          {!sub && (
            <>
              <span className="chat__crumbsep">/</span>
              <span className="chat__crumbthread">{thread.title}</span>
            </>
          )}
          {sub && <Tag>{t("thread.a2a")}</Tag>}
          {thread.channel && (
            <Tag>
              {isChannelKind(via) ? <KindIcon kind={via} size={11} /> : <Icons.Send size={11} />}{" "}
              {t("chat.viaChannel", { channel: channelLabel })}
            </Tag>
          )}
          {thread.kind === "code" && thread.cwd && (
            <span className="chat__code" title={thread.cwd}>
              {thread.engine || agent?.harness ? (
                <EngineIcon engine={thread.engine ?? agent?.harness ?? ""} size={12} />
              ) : (
                <Icons.Code size={12} />
              )}
              <span className="chat__cwd">{thread.cwd}</span>
              <Tag>{t(`write.${thread.write ?? "ask"}`)}</Tag>
            </span>
          )}
        </div>
      </div>
      <div className="chat__tools">
        <IconButton
          size="sm"
          label={tools ? t("chat.hideTools") : t("chat.showTools")}
          tooltip={t("chat.toolsHint")}
          icon={<Icons.Wrench size={14} />}
          className={tools ? "chat__toolsbtn is-on" : "chat__toolsbtn"}
          onClick={go.toggleTools}
        />
        {!sub && (
          <Menu
            align="end"
            trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
            items={[
              {
                label: t("chat.compact"),
                icon: <Icons.Layers size={14} />,
                onSelect: () => void compactThread(thread.id),
              },
            ]}
          />
        )}
        <span className="chat__toolsdiv" />
        {/* Usage opens from the composer's context chip; read-only chats have no composer, so it stays here. */}
        <PanelSwitcher wide={wide} skipUsage={!sub} />
      </div>
    </header>
  );
}
