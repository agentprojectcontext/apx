import { View } from "react-native";
import { sentenceCase } from "../format";
import { channelName, listedThreads } from "../hooks/chatSelectors";
import type { Agent, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { AgentAvatar, Dot, EmptyState, IconTile, ListGroup, ListRow, Screen, SubHeader } from "../ui/kit";
import { useTheme } from "../ui/theme";
import type { MoreId } from "./MorePage";

/** The plain lists behind More: agents (tap to chat), projects and channels. */
export function MoreDetailPage({
  id,
  data,
  back,
  chatWith,
  openProject,
}: {
  id: Exclude<MoreId, "routines" | "settings" | "apps" | "memory" | "files" | "about">;
  data: Workspace;
  back: () => void;
  chatWith: (agent: Agent) => void;
  openProject: (id: string) => void;
}) {
  const theme = useTheme();
  const agentName = (agentId: string) => data.agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const body = () => {
    if (id === "agents")
      return data.agents.length ? (
        <ListGroup>
          {data.agents.map((agent) => (
            <ListRow
              key={agent.id}
              label={agent.name}
              sub={sentenceCase(agent.description || agent.role)}
              leading={<AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={36} />}
              onPress={() => chatWith(agent)}
            />
          ))}
        </ListGroup>
      ) : (
        <EmptyState title={t("agents")} body={t("nothingHere")} icon="Bot" />
      );
    if (id === "projects") {
      const projects = data.projects.filter((project) => project.registered !== false);
      return (
        <ListGroup>
          {projects.map((project) => (
            <ListRow
              key={project.id}
              label={project.name}
              sub={project.description}
              detail={String(listedThreads(data.threads).filter((thread) => thread.project_id === project.id).length)}
              leading={<IconTile icon="Folder" tone="violet" />}
              onPress={() => openProject(project.id)}
            />
          ))}
        </ListGroup>
      );
    }
    if (id === "channels")
      return data.channels.length ? (
        <ListGroup>
          {data.channels.map((channel) => (
            <ListRow
              key={channel.id}
              label={channel.label || channelName(channel.type)}
              sub={`${channelName(channel.type)} · ${agentName(channel.agent_id)}`}
              leading={<IconTile icon="Send" tone="info" />}
              trailing={<Dot color={channel.enabled ? theme.brand : theme.fgSubtle} />}
            />
          ))}
        </ListGroup>
      ) : (
        <EmptyState title={t("channels")} body={t("channelsHow")} icon="Send" />
      );
    return null;
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={t(id)} back={back} />
      <Screen>{body()}</Screen>
    </View>
  );
}
