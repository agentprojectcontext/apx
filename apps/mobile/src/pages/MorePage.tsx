import { Pressable, StyleSheet, Text, View } from "react-native";
import { channelName } from "../hooks/chatSelectors";
import type { Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";
import { Dot, IconTile, ListGroup, ListRow, OwnerAvatar, PageTitle, Screen, type } from "../ui/kit";
import { theme } from "../ui/theme";
import type { Tone } from "../ui/tone";

export type MoreId = "routines" | "agents" | "projects" | "channels" | "memory" | "apps" | "files" | "settings";

const ROWS: Array<{ id: MoreId; label: Key; icon: IconName; tone: Tone }> = [
  { id: "routines", label: "routines", icon: "RefreshCw", tone: "info" },
  { id: "agents", label: "agents", icon: "Bot", tone: "brand" },
  { id: "projects", label: "projects", icon: "Folder", tone: "violet" },
  { id: "channels", label: "channels", icon: "Send", tone: "info" },
  { id: "memory", label: "memory", icon: "Brain", tone: "violet" },
  { id: "apps", label: "apps", icon: "LayoutGrid", tone: "brand" },
  { id: "files", label: "files", icon: "FileText", tone: "neutral" },
  { id: "settings", label: "settings", icon: "Settings", tone: "neutral" },
];

/** Each row's short summary, and whether it should read as a problem. */
function detailOf(id: MoreId, data: Workspace): { text?: string; bad?: boolean } {
  switch (id) {
    case "routines": {
      const active = data.routines.filter((routine) => routine.enabled).length;
      const failed = data.routines.filter((routine) => routine.enabled && routine.last?.state === "failed").length;
      const text = t("routinesActive", { n: active });
      return failed ? { text: `${text} · ${t("routinesFailed", { n: failed })}`, bad: true } : { text };
    }
    case "agents":
      return { text: String(data.agents.length) };
    case "projects":
      return { text: String(data.projects.filter((project) => project.registered !== false).length) };
    case "channels": {
      const types = [...new Set(data.channels.filter((c) => c.enabled).map((c) => channelName(c.type)))];
      return { text: types.join(" · ") || undefined };
    }
    case "memory":
      return { text: data.memories === undefined ? undefined : t("memoriesCount", { n: data.memories }) };
    default:
      return {};
  }
}

export function MorePage({
  data,
  host,
  online,
  onSelect,
}: {
  data: Workspace;
  host: string;
  online: boolean;
  onSelect: (id: MoreId) => void;
}) {
  return (
    <Screen gap={16} header={<PageTitle title={t("navMore")} />}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onSelect("settings")}
        style={({ pressed }) => [s.profile, pressed && { backgroundColor: theme.fill }]}
      >
        <OwnerAvatar name={data.owner} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={s.owner}>
            {data.owner || t("you")}
          </Text>
          <View style={s.status}>
            <Dot color={online ? theme.brand : theme.warning} />
            <Text numberOfLines={1} style={type.meta}>
              {online ? t("connectedTo", { host }) : t("offline")}
            </Text>
          </View>
        </View>
        <Icon name="ChevronRight" size={18} color={theme.fgMuted} />
      </Pressable>
      <ListGroup>
        {ROWS.map((row) => {
          const detail = detailOf(row.id, data);
          return (
            <ListRow
              key={row.id}
              label={t(row.label)}
              detail={detail.text}
              detailColor={detail.bad ? theme.danger : theme.fgSubtle}
              leading={<IconTile icon={row.icon} tone={row.tone} />}
              onPress={() => onSelect(row.id)}
            />
          );
        })}
      </ListGroup>
    </Screen>
  );
}

const s = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: theme.radiusLg,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  owner: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
});
