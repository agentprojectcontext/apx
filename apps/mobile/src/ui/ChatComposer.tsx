import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { t } from "../i18n";
import { Icon } from "./Icon";
import { Spinner } from "./kit";
import { theme } from "./theme";

export function ChatComposer({
  text,
  onChangeText,
  onSend,
  onStop,
  onApps,
  onModel,
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
  onApps: () => void;
  onModel: () => void;
  online: boolean;
  busy: boolean;
  stopping: boolean;
  agentName: string;
  model: string;
  usage?: string;
}) {
  const typed = Boolean(text.trim());
  // With nothing typed while the agent works, the main button stops it; with words, they go in (and steer it).
  const mainStops = busy && !typed;
  const disabled = !online || stopping || (!mainStops && !typed);
  return (
    <View style={s.composer}>
      <TextInput
        accessibilityLabel={t("message")}
        multiline
        value={text}
        onChangeText={onChangeText}
        placeholder={t("writeToAgent", { name: agentName })}
        placeholderTextColor={theme.fgSubtle}
        style={s.input}
      />
      <View style={s.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("apps")}
          onPress={onApps}
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
