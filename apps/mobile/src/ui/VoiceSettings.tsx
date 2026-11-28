// Settings › Voice on the phone: waking the super-agent by name (this phone's own switch), the phrases (shared, kept on
// the computer), and the permission to show over other apps.
import { useCallback, useEffect, useState } from "react";
import { AppState, Text, TextInput, View } from "react-native";
import { hasNativeVoice, nativeVoice } from "../../modules/apx-voice";
import { t } from "../i18n";
import { microphone } from "../voice";
import { Button, IconTile, ListGroup, ListRow, Toggle, useType } from "./kit";
import { makeStyles, useTheme } from "./theme";

type Status = { wake_words: string[]; ready: boolean };

export function VoiceSettings({
  name,
  load,
  saveWords,
}: {
  name: string;
  load: () => Promise<Status>;
  saveWords: (words: string[]) => Promise<{ wake_words: string[] }>;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [status, setStatus] = useState<Status>();
  const [wake, setWake] = useState(() => nativeVoice.wake());
  const [overlay, setOverlay] = useState(() => nativeVoice.canOverlay());
  const [words, setWords] = useState("");
  useEffect(() => {
    load()
      .then((st) => {
        setStatus(st);
        setWords(st.wake_words.join(", "));
      })
      .catch(() => setStatus({ wake_words: [], ready: false }));
  }, [load]);
  // Back from the system's settings: the permission may have changed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setOverlay(nativeVoice.canOverlay());
    });
    return () => sub.remove();
  }, []);
  const toggle = useCallback(async (on: boolean) => {
    if (on && !(await microphone())) return;
    nativeVoice.setWake(on);
    setWake(on);
  }, []);
  const commit = useCallback(() => {
    const list = words
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
    saveWords(list)
      .then((r) => setWords(r.wake_words.join(", ")))
      .catch(() => undefined);
  }, [words, saveWords]);
  if (!hasNativeVoice) return null;
  const phrase = status?.wake_words[0] ?? `ok ${name}`;
  const ready = status?.ready !== false;
  return (
    <>
      <Text style={s.label}>{t("setVoice")}</Text>
      <ListGroup>
        <ListRow
          label={t("voiceWake")}
          sub={ready ? t("voiceWakeHelp", { phrase, name }) : t("voiceWakeOff")}
          leading={<IconTile icon="Mic" />}
          trailing={<Toggle value={wake} label={t("voiceWake")} onChange={(on) => void toggle(on)} />}
          chevron={false}
        />
        {wake && !overlay ? (
          <ListRow
            label={t("voiceOverlay")}
            sub={t("voiceOverlayHelp")}
            leading={<IconTile icon="Smartphone" />}
            trailing={
              <Button label={t("voiceOverlayAllow")} size="sm" onPress={() => nativeVoice.openOverlaySettings()} />
            }
            chevron={false}
          />
        ) : null}
      </ListGroup>
      {wake ? (
        <View style={s.words}>
          <Text style={type.meta}>{t("voicePhrases")}</Text>
          <TextInput
            value={words}
            onChangeText={setWords}
            onEndEditing={commit}
            placeholder={`ok ${name}, che ${name}`}
            placeholderTextColor={theme.fgSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
          />
          <Text style={type.small}>{t("voicePhrasesHelp")}</Text>
        </View>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  words: { gap: 6, paddingHorizontal: 4 },
  input: {
    color: theme.fg,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
}));
