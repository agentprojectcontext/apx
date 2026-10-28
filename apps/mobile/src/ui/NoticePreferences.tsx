import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { channelName } from "../hooks/chatSelectors";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { type NotificationStatus, pushBuild } from "../notifications";
import { type NoticePrefs, noticeChannelChoice, QUIET_HOURS } from "../protocol";
import { Icon } from "./Icon";
import { Chip, IconTile, ListGroup, ListRow, Toggle, useType } from "./kit";
import { TimeButton } from "./TimeButton";
import { makeStyles, useTheme } from "./theme";

const BUDGETS = [1, 3, 5, 10, 0];

/** What "This phone" says under it: told with the app closed, still connecting, or why not. Every phone is told. */
function phoneSub(state: NotificationStatus["state"]) {
  if (state === "push") return "setThisPhoneSub";
  if (state === "registering" || state === "checking") return "setThisPhoneWaiting";
  if (state === "off" || state === "denied") return "setThisPhoneOff";
  if (state === "error") return "setThisPhoneBroken";
  return pushBuild() ? "setThisPhoneWaiting" : "setThisPhoneOpen";
}

export function NoticePreferences({
  prefs,
  change,
  data,
  status,
}: {
  prefs: NoticePrefs;
  change: (patch: Partial<NoticePrefs>) => void;
  data: Workspace;
  status: NotificationStatus["state"];
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const channels = data.channels.filter((channel) => channel.enabled);
  const quiet = prefs?.quiet_from && prefs.quiet_to ? `${prefs.quiet_from}–${prefs.quiet_to}` : undefined;
  // Turned off and on again, quiet hours come back as they were.
  const lastQuiet = useRef<[string, string]>([QUIET_HOURS.from, QUIET_HOURS.to]);
  if (prefs?.quiet_from && prefs.quiet_to) lastQuiet.current = [prefs.quiet_from, prefs.quiet_to];
  const choice = noticeChannelChoice(prefs.channel);
  const radio = (on: boolean) =>
    on ? <Icon name="Check" size={18} color={theme.fg} /> : <View style={{ width: 18 }} />;
  return (
    <>
      <Text style={s.label}>{t("setQuiet")}</Text>
      <ListGroup>
        <ListRow
          label={t("setQuietOn")}
          leading={<IconTile icon="Moon" />}
          trailing={
            <Toggle
              value={Boolean(quiet)}
              label={t("setQuietOn")}
              onChange={(on) =>
                change(
                  on
                    ? { quiet_from: lastQuiet.current[0], quiet_to: lastQuiet.current[1] }
                    : { quiet_from: undefined, quiet_to: undefined },
                )
              }
            />
          }
          chevron={false}
        />
      </ListGroup>
      {quiet && prefs.quiet_from && prefs.quiet_to ? (
        <View style={s.range}>
          <TimeButton
            label={t("setQuietFrom")}
            value={prefs.quiet_from}
            fallback={QUIET_HOURS.from}
            onPick={(from) => change({ quiet_from: from })}
          />
          <TimeButton
            label={t("setQuietTo")}
            value={prefs.quiet_to}
            fallback={QUIET_HOURS.to}
            onPick={(to) => change({ quiet_to: to })}
          />
        </View>
      ) : null}
      <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setQuietHelp")}</Text>
      <Text style={s.label}>{t("setPhone")}</Text>
      <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setWhereHelp")}</Text>
      <ListGroup>
        <ListRow
          label={t("setThisPhone")}
          sub={t(phoneSub(status))}
          leading={<IconTile icon="Smartphone" tone="brand" />}
          chevron={false}
        />
      </ListGroup>
      <Text style={s.label}>{t("setWhere")}</Text>
      <ListGroup>
        {channels.map((channel) => (
          <ListRow
            key={channel.id}
            label={channel.label || channelName(channel.type)}
            sub={`${channelName(channel.type)} · ${data.agents.find((a) => a.id === channel.agent_id)?.name ?? channel.agent_id}`}
            leading={<IconTile icon="Send" tone="info" />}
            trailing={radio(choice === channel.id)}
            chevron={false}
            onPress={() => change({ channel: channel.id })}
          />
        ))}
        <ListRow
          label={t("setAuto")}
          sub={t("setAutoSub")}
          leading={<IconTile icon="Zap" />}
          trailing={radio(choice === "auto")}
          chevron={false}
          onPress={() => change({ channel: undefined })}
        />
        <ListRow
          label={t("setNone")}
          sub={t("setNoneSub")}
          leading={<IconTile icon="BellOff" />}
          trailing={radio(choice === "none")}
          chevron={false}
          onPress={() => change({ channel: "none" })}
        />
      </ListGroup>
      <Text style={s.label}>{t("setBudget")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {BUDGETS.map((n) => (
          <Chip
            key={n}
            label={n ? String(n) : t("setNoCap")}
            selected={prefs.budget_per_day === n}
            onPress={() => change({ budget_per_day: n })}
          />
        ))}
      </ScrollView>
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  chips: { gap: 8 },
  range: { flexDirection: "row", gap: 8 },
}));
