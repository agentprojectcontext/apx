import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { type AppearancePref, currentAppearance, saveAppearance } from "../appearance";
import type { Creds } from "../creds";
import { useNoticePrefs } from "../hooks/useNoticePrefs";
import { useNotifications } from "../hooks/useNotifications";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { NoticeSound } from "../noticeSound";
import type { NoticePrefs } from "../protocol";
import { previewSound, setSoundPrefs, useSoundPrefs } from "../sounds";
import { Button, Chip, IconTile, ListGroup, ListRow, OwnerAvatar, Screen, SubHeader, Toggle, useType } from "../ui/kit";
import { NoticePreferences } from "../ui/NoticePreferences";
import { NotificationCard } from "../ui/NotificationCard";
import { makeStyles, useTheme } from "../ui/theme";

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
  const { prefs, change } = useNoticePrefs(load, save);
  const [look, setLook] = useState(currentAppearance);
  const sounds = useSoundPrefs();
  const pickLook = (pref: AppearancePref) => {
    setLook(pref);
    saveAppearance(pref).catch(() => undefined);
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={t("settings")} back={back} />
      <Screen gap={12}>
        <NotificationCard status={notifications.status} enable={notifications.enable} />
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
        {prefs ? (
          <NoticePreferences prefs={prefs} change={change} data={data} status={notifications.status.state} />
        ) : null}
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
