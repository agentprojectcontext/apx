import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Attachment } from "../chat/useAttachments";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";
import { Spinner } from "./kit";
import { makeStyles, useTheme } from "./theme";

export function ChatComposer({
  text,
  onChangeText,
  onSend,
  onStop,
  onAttach,
  onModel,
  attachments,
  onRemoveAttachment,
  voice,
  online,
  busy,
  stopping,
  agentName,
  model,
  usage,
}: {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAttach: () => void;
  onModel: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (key: string) => void;
  voice: { state: "idle" | "recording" | "transcribing"; seconds: number; start: () => void; stop: () => void };
  online: boolean;
  busy: boolean;
  stopping: boolean;
  agentName: string;
  model: string;
  usage?: string;
}) {
  const theme = useTheme();
  const s = useStyles();
  const uploading = attachments.some((item) => !item.id);
  const typed = Boolean(text.trim()) || (attachments.length > 0 && !uploading);
  const recording = voice.state === "recording";
  // With nothing typed while the agent works, the main button stops it; with words, they go in (and steer it).
  const mainStops = busy && !typed;
  const disabled = !online || stopping || uploading || (!mainStops && !typed);
  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;
  const plus = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("attach")}
      onPress={onAttach}
      disabled={recording}
      hitSlop={4}
      style={s.round}
    >
      <Icon name="Plus" size={18} color={theme.fgMuted} />
    </Pressable>
  );
  // One line like the panel's: + · words · mic · send; the model and how full the chat is sit under it, small.
  return (
    <View style={s.wrap}>
      <View style={s.composer}>
        {attachments.length ? (
          <View style={s.chips}>
            {attachments.map((item) => (
              <AttachmentTile key={item.key} item={item} onRemove={() => onRemoveAttachment(item.key)} />
            ))}
          </View>
        ) : null}
        <View style={s.line}>
          {plus}
          {recording || voice.state === "transcribing" ? (
            <View style={s.recording}>
              {recording ? <View style={s.redDot} /> : <Spinner size={14} />}
              <Text style={s.recordingText}>{recording ? `${t("recording")} ${clock}` : t("transcribing")}</Text>
            </View>
          ) : (
            <TextInput
              accessibilityLabel={t("message")}
              multiline
              value={text}
              onChangeText={onChangeText}
              placeholder={t("writeToAgent", { name: agentName })}
              placeholderTextColor={theme.fgSubtle}
              style={s.input}
            />
          )}
          {/* The mic stays while the agent works: a voice note goes in like typed words. */}
          {!typed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(recording ? "stopRecording" : "voiceNote")}
              disabled={!online || voice.state === "transcribing"}
              onPress={recording ? voice.stop : voice.start}
              hitSlop={6}
              style={[s.round, recording && { backgroundColor: theme.danger }]}
            >
              <Icon
                name={recording ? "Square" : "Mic"}
                size={recording ? 14 : 18}
                color={recording ? "#fff" : theme.fgMuted}
              />
            </Pressable>
          ) : null}
          {busy && typed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("stopAgent")}
              disabled={!online || stopping}
              onPress={onStop}
              hitSlop={6}
              style={[s.round, s.stop]}
            >
              {stopping ? <Spinner size={14} /> : <Icon name="Square" size={14} color={theme.fg} />}
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(mainStops ? "stopAgent" : "send")}
            accessibilityState={{ disabled, busy: stopping }}
            onPress={mainStops ? onStop : onSend}
            disabled={disabled}
            hitSlop={6}
            style={[s.round, s.send, { backgroundColor: disabled ? theme.fillStrong : theme.accent }]}
          >
            {stopping && mainStops ? (
              <Spinner size={14} />
            ) : (
              <Icon
                name={mainStops ? "Square" : "ArrowUp"}
                size={mainStops ? 14 : 17}
                color={disabled ? theme.fgMuted : theme.accentFg}
              />
            )}
          </Pressable>
        </View>
      </View>
      <View style={s.meta}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("modelForChat")}
          onPress={onModel}
          hitSlop={8}
          style={({ pressed }) => [s.model, pressed && { backgroundColor: theme.fill }]}
        >
          <Icon name="Bot" size={12} color={theme.fgSubtle} />
          <Text numberOfLines={1} style={s.metaText}>
            {model}
          </Text>
          <Icon name="ChevronDown" size={11} color={theme.fgSubtle} />
        </Pressable>
        {usage ? (
          <View style={s.usage}>
            <Icon name="Zap" size={11} color={theme.fgSubtle} />
            <Text style={s.metaText}>{usage}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const fileIcon = (mime: string): IconName =>
  mime.startsWith("audio/")
    ? "FileAudio"
    : /zip|tar|rar|7z|gzip/.test(mime)
      ? "FileArchive"
      : /^text\/|pdf|json|xml|word|document|sheet|csv|markdown/.test(mime)
        ? "FileText"
        : "File";

/** A photo as its thumbnail; any other file as its kind's icon over a name cut short. */
function AttachmentTile({ item, onRemove }: { item: Attachment; onRemove: () => void }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.tile}>
      {item.kind === "image" ? (
        <Image source={{ uri: item.uri }} style={s.thumb} />
      ) : (
        <View style={s.fileTile}>
          <Icon name={fileIcon(item.mime)} size={20} color={theme.fgMuted} />
          <Text numberOfLines={1} ellipsizeMode="middle" style={s.fileName}>
            {item.name}
          </Text>
        </View>
      )}
      {item.id ? null : (
        <View style={s.tileBusy}>
          <Spinner size={16} />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("removeAttachment")}: ${item.name}`}
        hitSlop={8}
        onPress={onRemove}
        style={s.tileRemove}
      >
        <Icon name="X" size={11} color={theme.fg} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2 },
  tile: { width: 64, height: 64, marginTop: 4, marginRight: 4 },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: theme.fill },
  fileTile: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: theme.fill,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  fileName: { color: theme.fgMuted, fontSize: 10, maxWidth: 52 },
  tileBusy: {
    ...StyleSheet.absoluteFill,
    borderRadius: 12,
    backgroundColor: theme.overlay,
    alignItems: "center",
    justifyContent: "center",
  },
  tileRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.fillStrong,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  recording: { flex: 1, minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8 },
  redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
  recordingText: { color: theme.fg, fontSize: 15, fontVariant: ["tabular-nums"] },
  wrap: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 },
  composer: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  line: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  input: {
    flex: 1,
    maxHeight: 132,
    minHeight: 36,
    color: theme.fg,
    fontSize: 15,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 8,
    textAlignVertical: "center",
  },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  send: { width: 34, height: 34, borderRadius: 17, margin: 1 },
  stop: { borderWidth: 1, borderColor: theme.borderStrong, marginRight: 2 },
  meta: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    height: 24,
  },
  model: {
    maxWidth: 200,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  metaText: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  usage: { flexDirection: "row", alignItems: "center", gap: 3 },
}));
