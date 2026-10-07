import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Attachment } from "../chat/useAttachments";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { Spinner } from "./kit";
import { theme } from "./theme";

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
  const uploading = attachments.some((item) => !item.id);
  const typed = Boolean(text.trim()) || (attachments.length > 0 && !uploading);
  const recording = voice.state === "recording";
  // With nothing typed while the agent works, the main button stops it; with words, they go in (and steer it).
  const mainStops = busy && !typed;
  const disabled = !online || stopping || uploading || (!mainStops && !typed);
  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;
  return (
    <View style={s.composer}>
      {attachments.length ? (
        <View style={s.chips}>
          {attachments.map((item) => (
            <View key={item.key} style={s.chip}>
              {item.id ? (
                <Icon
                  name={item.kind === "image" ? "Image" : item.kind === "audio" ? "Mic" : "Paperclip"}
                  size={13}
                  color={theme.fgMuted}
                />
              ) : (
                <Spinner size={12} />
              )}
              <Text numberOfLines={1} style={s.chipText}>
                {item.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("removeAttachment")}
                hitSlop={8}
                onPress={() => onRemoveAttachment(item.key)}
              >
                <Icon name="X" size={13} color={theme.fgSubtle} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
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
      <View style={s.toolbar}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("modelForChat")}
          onPress={onModel}
          style={({ pressed }) => [s.model, pressed && { backgroundColor: theme.fillHover }]}
        >
          <Icon name="Bot" size={14} color={theme.fgMuted} />
          <Text numberOfLines={1} style={s.modelText}>
            {model}
          </Text>
          <Icon name="ChevronDown" size={12} color={theme.fgMuted} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {usage ? (
          <View style={s.usage}>
            <Icon name="Zap" size={12} color={theme.fgSubtle} />
            <Text style={s.usageText}>{usage}</Text>
          </View>
        ) : null}
        {!typed && !mainStops ? (
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
          style={[s.round, { backgroundColor: disabled ? theme.fillStrong : theme.accent }]}
        >
          {stopping && mainStops ? (
            <Spinner size={14} />
          ) : (
            <Icon
              name={mainStops ? "Square" : "ArrowUp"}
              size={mainStops ? 15 : 18}
              color={disabled ? theme.fgMuted : theme.accentFg}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginLeft: -4 },
  chip: {
    maxWidth: 200,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipText: { color: theme.fg, fontSize: 12, flexShrink: 1 },
  recording: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
  recordingText: { color: theme.fg, fontSize: 15, fontVariant: ["tabular-nums"] },
  composer: {
    marginHorizontal: 10,
    marginVertical: 6,
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 8,
    paddingLeft: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    gap: 8,
  },
  input: { maxHeight: 132, minHeight: 28, color: theme.fg, fontSize: 15, paddingVertical: 4, textAlignVertical: "top" },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -8 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  stop: { borderWidth: 1, borderColor: theme.borderStrong, marginRight: 4 },
  model: {
    height: 32,
    maxWidth: 170,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: theme.fill,
  },
  modelText: { color: theme.fgMuted, fontSize: 12, flexShrink: 1 },
  usage: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: 4 },
  usageText: { color: theme.fgSubtle, fontSize: 12 },
});
