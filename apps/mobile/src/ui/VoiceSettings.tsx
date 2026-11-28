// Settings › Voice on the phone: waking the super-agent by name (this phone's own switch), the phrases (shared, kept on
// the computer), and the permission to show over other apps.
import { useCallback, useEffect, useState } from "react";
import { AppState, Text, TextInput, View } from "react-native";
import { hasNativeVoice, nativeVoice } from "../../modules/apx-voice";
import { t } from "../i18n";
import { microphone } from "../voice";
import { addPhrase, isUsual, removePhrase, usualWakeWords, type VoiceRead } from "../wakeWords";
import { Icon } from "./Icon";
import { Button, IconButton, IconTile, ListGroup, ListRow, Toggle, useType } from "./kit";
import { makeStyles, useTheme } from "./theme";

export function VoiceSettings({
  name,
  load,
  saveWords,
  online = true,
}: {
  name: string;
  load: () => Promise<VoiceRead>;
  saveWords: (words: string[]) => Promise<{ wake_words: string[] }>;
  /** The core answers: read again when it comes back. */
  online?: boolean;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [status, setStatus] = useState<VoiceRead>({ state: "loading" });
  // A read that failed keeps what the last good one showed.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [wake, setWake] = useState(() => nativeVoice.wake());
  const [overlay, setOverlay] = useState(() => nativeVoice.canOverlay());
  const [typed, setTyped] = useState("");
  // Read on open, each time the core comes back and each time the app returns to the screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only asks for another read
  useEffect(() => {
    if (!online) return;
    let live = true;
    const fail = () => live && setFailed(true);
    load()
      .then((read) => {
        if (!live) return;
        if (read.state !== "loaded") return fail();
        setStatus(read);
        setFailed(false);
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, [load, online, attempt]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Back from the system's settings: the permission may have changed.
      setOverlay(nativeVoice.canOverlay());
      setAttempt((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  const toggle = useCallback(async (on: boolean) => {
    if (on && !(await microphone())) return;
    nativeVoice.setWake(on);
    setWake(on);
  }, []);
  const words = status.state === "loaded" ? status.wake_words : [];
  const save = (next: string[]) => {
    if (status.state !== "loaded") return;
    setStatus({ ...status, wake_words: next.length ? next : usualWakeWords(name) });
    saveWords(next)
      .then((r) => setStatus((now) => (now.state === "loaded" ? { ...now, wake_words: r.wake_words } : now)))
      .catch(() => setAttempt((n) => n + 1));
  };
  const add = () => {
    const next = addPhrase(words, typed);
    if (next.length !== words.length) save(next);
    setTyped("");
  };
  if (!hasNativeVoice) return null;
  const usual = isUsual(words, name);
  // The core away or a read that failed: said once, read again when it is back.
  const unreachable = failed || !online;
  const sub =
    !unreachable && status.state === "loaded" && status.ready === false
      ? t("voiceWakeOff")
      : status.state === "loaded" && status.preparing
        ? t("voiceGreetingPreparing")
        : t("voiceWakeHere");
  return (
    <>
      <Text style={s.label}>{t("setVoice")}</Text>
      <ListGroup>
        <ListRow
          label={t("voiceWake")}
          sub={sub}
          wrap
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
        {unreachable ? (
          <ListRow
            label={t("voiceUnreachable")}
            wrap
            leading={<IconTile icon="TriangleAlert" />}
            trailing={<Button label={t("retry")} size="sm" onPress={() => setAttempt((n) => n + 1)} />}
            chevron={false}
          />
        ) : null}
      </ListGroup>
      {status.state === "loaded" ? (
        <View style={s.words}>
          <Text style={type.meta}>{t("voicePhrases")}</Text>
          <View style={s.chips}>
            {words.map((phrase) => (
              <View key={phrase} style={s.chip}>
                <Text numberOfLines={1} style={s.chipText}>
                  {phrase}
                </Text>
                <IconButton
                  icon="X"
                  label={t("voicePhraseRemove", { phrase })}
                  size={14}
                  color={theme.fgMuted}
                  style={s.chipRemove}
                  onPress={() => save(removePhrase(words, phrase))}
                />
              </View>
            ))}
          </View>
          <View style={s.addRow}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={add}
              accessibilityLabel={t("voicePhraseNew")}
              placeholder={t("voicePhrasePlaceholder", { name })}
              placeholderTextColor={theme.fgSubtle}
              returnKeyType="done"
              submitBehavior="submit"
              autoCapitalize="sentences"
              autoCorrect={false}
              style={s.input}
            />
            <IconButton icon="Plus" label={t("voicePhraseAdd")} size={18} color={theme.fg} onPress={add} />
          </View>
          <View style={s.foot}>
            <Icon name={usual ? "Check" : "Monitor"} size={13} color={theme.fgSubtle} />
            <Text style={[type.small, s.footText]}>{t(usual ? "voicePhrasesUsual" : "voicePhrasesShared")}</Text>
            {usual ? null : (
              <Button label={t("voicePhrasesReset")} size="sm" variant="secondary" onPress={() => save([])} />
            )}
          </View>
        </View>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  label: { color: theme.fgSubtle, fontSize: 12, paddingHorizontal: 4, paddingTop: 8 },
  words: { gap: 8, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    paddingLeft: 12,
    borderRadius: 999,
    backgroundColor: theme.fill,
    maxWidth: "100%",
  },
  chipText: { color: theme.fg, fontSize: 14, flexShrink: 1 },
  chipRemove: { width: 30, height: 30 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  input: {
    flex: 1,
    color: theme.fg,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radiusMd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  foot: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 },
  footText: { flex: 1 },
}));
