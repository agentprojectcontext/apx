import { Text, View } from "react-native";
import type { Workspace } from "../../hooks/useWorkspace";
import { t } from "../../i18n";
import type { SharedFile } from "../../protocol";
import { AgentAvatar, OwnerAvatar, useType } from "../kit";
import { PersonAvatar } from "../PersonAvatar";

/** Who sent a shared file, as an avatar and a name: the owner, an agent, a contact or a widget. */
export function Sender({ author, data, size }: { author: SharedFile["author"]; data: Workspace; size: number }) {
  const type = useType();
  const agent = author.kind === "agent" ? data.agents.find((a) => a.id === author.id) : undefined;
  const name =
    author.kind === "user"
      ? t("you")
      : author.kind === "agent"
        ? (agent?.name ?? "")
        : author.kind === "person"
          ? author.name
          : author.kind === "surface"
            ? author.title
            : "";
  if (!name) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
      {author.kind === "agent" ? (
        <AgentAvatar name={name} blob={agent?.blob} id={author.id} size={size} />
      ) : author.kind === "user" ? (
        <OwnerAvatar name={data.owner || name} size={size} />
      ) : (
        <PersonAvatar person={author.kind === "person" ? author.id : undefined} name={name} size={size} />
      )}
      <Text numberOfLines={1} style={[type.meta, { flexShrink: 1 }]}>
        {name}
      </Text>
    </View>
  );
}
