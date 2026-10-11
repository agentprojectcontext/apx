import Constants from "expo-constants";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Creds } from "../creds";
import { channelName } from "../hooks/chatSelectors";
import { useNotifications } from "../hooks/useNotifications";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { NoticePrefs } from "../protocol";
import { Icon } from "../ui/Icon";
import { Button, Chip, IconTile, ListGroup, ListRow, OwnerAvatar, Screen, SubHeader, type } from "../ui/kit";
import { NotificationCard } from "../ui/NotificationCard";
import { theme } from "../ui/theme";

const QUIET: Array<[string, string]> = [
  ["22:00", "07:00"],
  ["23:00", "08:00"],
  ["00:00", "09:00"],
];
const BUDGETS = [1, 3, 5, 10, 0];

/** The few settings worth changing from a phone; the rest stay in the panel. */
export function SettingsPage({
  creds,
  data,
  host,
  back,
  disconnect,
  load,
  save,
}: {
  creds: Creds;
  data: Workspace;
  host: string;
  back: () => void;
  disconnect: () => void;
  load: () => Promise<NoticePrefs>;
  save: (prefs: NoticePrefs) => Promise<NoticePrefs>;
}) {
  const notifications = useNotifications(creds);
  const [prefs, setPrefs] = useState<NoticePrefs>();
  const saved = useRef<NoticePrefs>(undefined);
  const request = useRef(0);
  useEffect(() => {
    void load()
      .then((result) => {
        saved.current = result;
        setPrefs(result);
      })
      .catch(() => undefined);
  }, [load]);
  const change = (patch: Partial<NoticePrefs>) => {
    if (!prefs) return;
    const before = saved.current ?? prefs;
    const next = { ...prefs, ...patch };
    // Quick taps: only the newest answer is shown, and a failure goes back to what the core last confirmed.
    const mine = ++request.current;
    setPrefs(next);
    save(next)
      .then((result) => {
        saved.current = result;
        if (mine === request.current) setPrefs(result);
      })
      .catch((error) => {
        if (mine === request.current) setPrefs(before);
        Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
      });
  };
  const device = `device:${creds.device}`;
  const channels = data.channels.filter((channel) => channel.enabled);
  const quiet = prefs?.quiet_from && prefs.quiet_to ? `${prefs.quiet_from}–${prefs.quiet_to}` : undefined;
  const radio = (on: boolean) =>
    on ? <Icon name="Check" size={18} color={theme.fg} /> : <View style={{ width: 18 }} />;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={t("settings")} back={back} />
      <Screen gap={12}>
        <NotificationCard status={notifications.status} enable={notifications.enable} />
        {prefs ? (
          <>
            <Text style={s.label}>{t("setWhere")}</Text>
            <ListGroup>
              <ListRow
                label={t("setThisPhone")}
                sub={t(notifications.status.state === "push" ? "setThisPhoneSub" : "setThisPhoneOpen")}
                leading={<IconTile icon="Smartphone" tone="brand" />}
                trailing={radio(prefs.channel === device)}
                chevron={false}
                onPress={() => change({ channel: device })}
              />
              {channels.map((channel) => (
                <ListRow
                  key={channel.id}
                  label={channel.label || channelName(channel.type)}
                  sub={`${channelName(channel.type)} · ${data.agents.find((a) => a.id === channel.agent_id)?.name ?? channel.agent_id}`}
                  leading={<IconTile icon="Send" tone="info" />}
                  trailing={radio(prefs.channel === channel.id)}
                  chevron={false}
                  onPress={() => change({ channel: channel.id })}
                />
              ))}
              <ListRow
                label={t("setAuto")}
                sub={t("setAutoSub")}
                leading={<IconTile icon="Zap" />}
                trailing={radio(!prefs.channel)}
                chevron={false}
                onPress={() => change({ channel: undefined })}
              />
            </ListGroup>
            <Text style={s.label}>{t("setQuiet")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {quiet && !QUIET.some(([from, to]) => quiet === `${from}–${to}`) ? (
                <Chip label={quiet} selected onPress={() => undefined} />
              ) : null}
              <Chip
                label={t("setQuietOff")}
                selected={!quiet}
                onPress={() => change({ quiet_from: undefined, quiet_to: undefined })}
              />
              {QUIET.map(([from, to]) => (
                <Chip
                  key={from}
                  label={`${from}–${to}`}
                  selected={quiet === `${from}–${to}`}
                  onPress={() => change({ quiet_from: from, quiet_to: to })}
                />
              ))}
            </ScrollView>
            <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setQuietHelp")}</Text>
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
        ) : null}
        <Text style={s.label}>{t("setConnection")}</Text>
        <ListGroup>
          <ListRow
            label={data.owner || t("you")}
            sub={t("connectedTo", { host })}
            leading={<OwnerAvatar name={data.owner} size={34} />}
            chevron={false}
          />
          <ListRow label={creds.url} leading={<IconTile icon="Link" />} chevron={false} />
        </ListGroup>
        <Button
          label={t("disconnect")}
          variant="secondary"
          style={{ alignSelf: "stretch" }}
          onPress={() =>
            Alert.alert(t("disconnect"), t("disconnectAsk"), [
              { text: t("cancel"), style: "cancel" },
              { text: t("disconnect"), style: "destructive", onPress: disconnect },
            ])
          }
        />
        <Text style={[type.small, { textAlign: "center" }]}>
          {t("setVersion", { version: Constants.expoConfig?.version ?? "" })}
        </Text>
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  chips: { gap: 8 },
});
