import { Linking, Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { channelName } from "../hooks/chatSelectors";
import type { Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import { CHANNEL_MARKS } from "../ui/channelMarks";
import type { IconName } from "../ui/Icon";
import { Icon } from "../ui/Icon";
import { Dot, IconTile, ListGroup, ListRow, OwnerAvatar, PageTitle, Screen, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";
import type { Tone } from "../ui/tone";

const DISCORD = "https://discord.gg/vxdZuT5WuE";

export type MoreId =
  | "routines"
  | "agents"
  | "projects"
  | "channels"
  | "memory"
  | "apps"
  | "files"
  | "settings"
  | "about";

const ROWS: Array<{ id: MoreId; label: Key; icon: IconName; tone: Tone }> = [
  { id: "routines", label: "routines", icon: "RefreshCw", tone: "info" },
  { id: "agents", label: "agents", icon: "Bot", tone: "brand" },
  { id: "projects", label: "projects", icon: "Folder", tone: "violet" },
  { id: "channels", label: "channels", icon: "Send", tone: "info" },
  { id: "memory", label: "memory", icon: "Brain", tone: "violet" },
  { id: "apps", label: "apps", icon: "LayoutGrid", tone: "brand" },
  { id: "files", label: "files", icon: "FileText", tone: "neutral" },
  { id: "settings", label: "settings", icon: "Settings", tone: "neutral" },
  { id: "about", label: "about", icon: "Info", tone: "neutral" },
];

/** Each row's short summary, and whether it should read as a problem. */
function detailOf(id: MoreId, data: Workspace): { text?: string; bad?: boolean } {
  switch (id) {
    case "routines": {
      const active = data.routines.filter((routine) => routine.enabled).length;
      const failed = data.routines.filter((routine) => routine.enabled && routine.last?.state === "failed").length;
      const text = t("routinesActive", { n: active });
      return failed
        ? { text: `${text} · ${failed === 1 ? t("routinesFailedOne") : t("routinesFailed", { n: failed })}`, bad: true }
        : { text };
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
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  return (
    <Screen
      gap={16}
      header={
        <PageTitle
          title={t("navMore")}
          right={
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("joinDiscord")}
              onPress={() => void Linking.openURL(DISCORD)}
              style={({ pressed }) => [s.discord, pressed && { opacity: 0.85 }]}
            >
              <DiscordMark />
              <Text style={s.discordText}>{t("joinUs")}</Text>
            </Pressable>
          }
        />
      }
    >
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

/** Discord's own mark, in white on its color. */
function DiscordMark() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      {CHANNEL_MARKS.discord.paths.map((path) => (
        <Path key={path.d.slice(0, 12)} d={path.d} fill="#fff" />
      ))}
    </Svg>
  );
}

const useStyles = makeStyles((theme) => ({
  discord: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#5865F2",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  discordText: { color: "#fff", fontSize: 13, fontWeight: "600" },
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
}));
