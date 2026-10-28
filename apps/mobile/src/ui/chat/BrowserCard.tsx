import { Linking, Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { Dot } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { hostPath, opensOnPhone } from "./blocks";

type BrowserPart = Extract<Message["parts"][number], { type: "browser" }>;

/**
 * A page the agent works on in the computer's browser (or the virtual machine's screen). The live tab stays on the
 * computer; a plain web page opens here in the phone's browser.
 */
export function BrowserCard({ part, agentName }: { part: BrowserPart; agentName: string }) {
  const theme = useTheme();
  const s = useStyles();
  const vm = part.environment === "vm";
  const host = hostPath(part.url);
  const title = part.title || host;
  const status = vm
    ? t("browserComputer")
    : part.state === "handoff"
      ? (part.reason ?? t("browserHandoff", { name: agentName }))
      : part.state === "user"
        ? t("browserYouControl")
        : part.state === "agent"
          ? t("browserAgentBrowsing", { name: agentName, host })
          : t("browserFinished", { host });
  const live = !vm && part.state !== "done";
  const opens = !vm && opensOnPhone(part.url);
  return (
    <Pressable
      accessibilityRole={opens ? "link" : undefined}
      accessibilityLabel={`${title}. ${status}`}
      accessibilityHint={opens ? t("browserOpenHint") : undefined}
      disabled={!opens}
      onPress={() => void Linking.openURL(part.url).catch(() => undefined)}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: theme.fill }]}
    >
      <View style={s.tile}>
        <Icon name={vm ? "Monitor" : "Globe"} size={18} color={theme.brandSoftFg} />
      </View>
      <View style={s.body}>
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
        {vm ? null : (
          <Text numberOfLines={1} style={s.host}>
            {host}
          </Text>
        )}
        <View style={s.statusRow}>
          {live ? <Dot color={part.state === "handoff" ? theme.warning : theme.brand} size={6} /> : null}
          <Text numberOfLines={2} style={[s.status, part.state === "handoff" && !vm && { color: theme.warning }]}>
            {status}
          </Text>
        </View>
      </View>
      {opens ? <Icon name="ExternalLink" size={15} color={theme.fgSubtle} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    alignSelf: "stretch",
    maxWidth: 420,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.fg, fontSize: 14, fontWeight: "600" },
  host: { color: theme.fgSubtle, fontSize: 12, fontFamily: theme.mono },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  status: { color: theme.fgMuted, fontSize: 12, flexShrink: 1 },
}));
