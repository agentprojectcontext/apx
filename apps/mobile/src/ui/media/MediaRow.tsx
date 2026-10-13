import { type AudioPlayer, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type MediaItem, sizeText } from "../../chat/media";
import { shareMedia } from "../../chat/mediaFiles";
import { t } from "../../i18n";
import { Icon } from "../Icon";
import { Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { useMediaClient, useMediaUri } from "./context";

/** A sound plays right here; any other file opens in the share sheet. A long press offers the rest. */
export function MediaRow({ item, onMenu }: { item: MediaItem; onMenu: (item: MediaItem) => void }) {
  return item.kind === "audio" ? <AudioRow item={item} onMenu={onMenu} /> : <FileRow item={item} onMenu={onMenu} />;
}

function FileRow({ item, onMenu }: { item: MediaItem; onMenu: (item: MediaItem) => void }) {
  const theme = useTheme();
  const s = useStyles();
  const client = useMediaClient();
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.name}
      onPress={() => {
        setBusy(true);
        void shareMedia(client, item).finally(() => setBusy(false));
      }}
      onLongPress={() => onMenu(item)}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: theme.fill }]}
    >
      {busy ? <Spinner size={14} /> : <Icon name="FileText" size={16} color={theme.fgMuted} />}
      <Text numberOfLines={1} style={s.name}>
        {item.name}
      </Text>
      <Text style={s.size}>{sizeText(item.bytes)}</Text>
    </Pressable>
  );
}

function AudioRow({ item, onMenu }: { item: MediaItem; onMenu: (item: MediaItem) => void }) {
  const theme = useTheme();
  const s = useStyles();
  const [want, setWant] = useState(false);
  const { uri, error } = useMediaUri(item, want);
  if (uri) return <AudioControls uri={uri} item={item} onMenu={onMenu} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("playAudio")}
      onPress={() => setWant(true)}
      onLongPress={() => onMenu(item)}
      style={s.audio}
    >
      <View style={s.audioButton}>
        {want && !error ? <Spinner size={14} /> : <Icon name="Play" size={16} color={theme.accentFg} />}
      </View>
      <View style={s.track}>
        <View style={s.trackFill} />
      </View>
      <Text style={s.size}>{error ? t("mediaUnavailable") : sizeText(item.bytes) || "--:--"}</Text>
    </Pressable>
  );
}

const clockOf = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The one sound playing in the app: starting another stops it, as in a messaging app. */
let playing: AudioPlayer | undefined;

function AudioControls({ uri, item, onMenu }: { uri: string; item: MediaItem; onMenu: (item: MediaItem) => void }) {
  const theme = useTheme();
  const s = useStyles();
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const play = useCallback(() => {
    if (playing && playing !== player) playing.pause();
    playing = player;
    player.play();
  }, [player]);
  // It was loaded because play was pressed: it starts now, and stops when the chat closes.
  useEffect(() => {
    play();
    return () => {
      if (playing === player) playing = undefined;
    };
  }, [play, player]);
  // At the end it stops and goes back to the start; seeking alone would play it again on Android.
  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    void player.seekTo(0);
  }, [status.didJustFinish, player]);
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(status.playing ? "pauseAudio" : "playAudio")}
      onPress={() => (status.playing ? player.pause() : play())}
      onLongPress={() => onMenu(item)}
      style={s.audio}
    >
      <View style={s.audioButton}>
        <Icon name={status.playing ? "Pause" : "Play"} size={16} color={theme.accentFg} />
      </View>
      <View style={s.track}>
        <View style={[s.trackFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={s.size}>
        {clockOf(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    maxWidth: "88%",
  },
  name: { color: theme.fg, fontSize: 13, flexShrink: 1 },
  size: { color: theme.fgSubtle, fontSize: 12, fontFamily: theme.mono },
  audio: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: 240,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: theme.fill,
  },
  audioButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: theme.border, overflow: "hidden" },
  trackFill: { height: 4, width: 0, backgroundColor: theme.fgMuted },
}));
