import Constants from "expo-constants";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { type AppearancePref, currentAppearance, saveAppearance } from "../appearance";
import type { Creds } from "../creds";
import { channelName } from "../hooks/chatSelectors";
import { useNotifications } from "../hooks/useNotifications";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { NoticeSound } from "../noticeSound";
import { type NotificationStatus, pushBuild } from "../notifications";
import type { NoticePrefs } from "../protocol";
import { previewSound, setSoundPrefs, useSoundPrefs } from "../sounds";
import { Icon } from "../ui/Icon";
import { Button, Chip, IconTile, ListGroup, ListRow, OwnerAvatar, Screen, SubHeader, Toggle, useType } from "../ui/kit";
import { NotificationCard } from "../ui/NotificationCard";
import { TimeButton } from "../ui/TimeButton";
import { makeStyles, useTheme } from "../ui/theme";

const BUDGETS = [1, 3, 5, 10, 0];
const SOUND_MODES: Array<[NoticeSound, "soundAll" | "soundMessages" | "soundRequests" | "soundOff"]> = [
  ["all", "soundAll"],
  ["messages", "soundMessages"],
  ["requests", "soundRequests"],
  ["off", "soundOff"],
];
const LOOKS: Array<[AppearancePref, "setLookSystem" | "setLookLight" | "setLookDark"]> = [
  ["system", "setLookSystem"],
  ["light", "setLookLight"],
  ["dark", "setLookDark"],
];

/** What "This phone" says under it: reached with the app closed, still connecting, or why not. */
function phoneSub(state: NotificationStatus["state"]) {
  if (state === "push") return "setThisPhoneSub";
  if (state === "registering" || state === "checking") return "setThisPhoneWaiting";
  if (state === "off" || state === "denied") return "setThisPhoneOff";
  if (state === "error") return "setThisPhoneBroken";
  return pushBuild() ? "setThisPhoneWaiting" : "setThisPhoneOpen";
}

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
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const notifications = useNotifications(creds);
  const [prefs, setPrefs] = useState<NoticePrefs>();
  const [look, setLook] = useState(currentAppearance);
  const sounds = useSoundPrefs();
  const pickLook = (pref: AppearancePref) => {
    setLook(pref);
    saveAppearance(pref).catch(() => undefined);
  };
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
  // Turned off and on again, quiet hours come back as they were.
  const lastQuiet = useRef<[string, string]>(["22:00", "07:00"]);
  if (prefs?.quiet_from && prefs.quiet_to) lastQuiet.current = [prefs.quiet_from, prefs.quiet_to];
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
            <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setWhereHelp")}</Text>
            <ListGroup>
              <ListRow
                label={t("setThisPhone")}
                sub={t(phoneSub(notifications.status.state))}
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
                  fallback="22:00"
                  onPick={(from) => change({ quiet_from: from })}
                />
                <TimeButton
                  label={t("setQuietTo")}
                  value={prefs.quiet_to}
                  fallback="07:00"
                  onPick={(to) => change({ quiet_to: to })}
                />
              </View>
            ) : null}
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
        <Text style={s.label}>{t("setSounds")}</Text>
        <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setNoticeSound")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {SOUND_MODES.map(([mode, label]) => (
            <Chip
              key={mode}
              label={t(label)}
              selected={sounds.notice === mode}
              onPress={() => {
                setSoundPrefs({ notice: mode });
                if (mode !== "off") previewSound("notice");
              }}
            />
          ))}
        </ScrollView>
        <Text style={[type.meta, { paddingHorizontal: 4 }]}>{t("setNoticeSoundHelp")}</Text>
        <ListGroup>
          <ListRow
            label={t("setAudioEnd")}
            sub={t("setAudioEndHelp")}
            leading={<IconTile icon="Music" />}
            trailing={
              <Toggle
                value={sounds.audioEnd}
                label={t("setAudioEnd")}
                onChange={(on) => {
                  setSoundPrefs({ audioEnd: on });
                  if (on) previewSound("audioEnd");
                }}
              />
            }
            chevron={false}
          />
        </ListGroup>
        <Text style={s.label}>{t("setLook")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {LOOKS.map(([pref, label]) => (
            <Chip key={pref} label={t(label)} selected={look === pref} onPress={() => pickLook(pref)} />
          ))}
        </ScrollView>
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

const useStyles = makeStyles((theme) => ({
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  chips: { gap: 8 },
  range: { flexDirection: "row", gap: 8 },
}));
