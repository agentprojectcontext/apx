import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { t as translate } from "../i18n";
import { Icon } from "./Icon";
import { theme as t } from "./theme";

export function ChatComposer({
  text,
  onChangeText,
  onSend,
  onStop,
  onApps,
  online,
  busy,
  stopping,
  agentName,
  model,
}: {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onApps: () => void;
  online: boolean;
  busy: boolean;
  stopping: boolean;
  agentName: string;
  model?: string;
}) {
  const mainStops = busy && !text.trim();
  const disabled = !online || stopping || (!mainStops && !text.trim());
  return (
    <View style={s.composer}>
      <TextInput
        accessibilityLabel={translate("message")}
        multiline
        value={text}
        onChangeText={onChangeText}
        placeholder={translate("writeToAgent", { name: agentName })}
        placeholderTextColor={t.subtle}
        style={s.input}
        onSubmitEditing={onSend}
        returnKeyType="send"
      />
      <View style={s.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={translate("apps")} onPress={onApps} style={s.chip}>
          <Icon name="Plus" size={20} />
        </Pressable>
        <View style={s.modelChip}>
          <Icon name="Bot" size={13} />
          <Text numberOfLines={1} style={s.model}>
            {model ?? agentName}
          </Text>
        </View>
        <View style={s.spacer} />
        {busy && !mainStops ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translate("stopAgent")}
            disabled={!online || stopping}
            onPress={onStop}
            hitSlop={7}
            style={s.stopSecondary}
          >
            {stopping ? (
              <ActivityIndicator size="small" color={t.muted} />
            ) : (
              <Icon name="Square" size={16} color={t.fg} />
            )}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate(mainStops ? "stopAgent" : "send")}
          accessibilityState={{ disabled, busy: stopping }}
          onPress={mainStops ? onStop : onSend}
          disabled={disabled}
          hitSlop={7}
          style={[s.action, disabled && s.disabled]}
        >
          {stopping && mainStops ? (
            <ActivityIndicator size="small" color={t.muted} />
          ) : (
            <Icon
              name={mainStops ? "Square" : "ArrowUp"}
              size={mainStops ? 17 : 20}
              color={disabled ? t.muted : t.accentFg}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  composer: {
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 20,
    backgroundColor: t.surface,
    marginHorizontal: 10,
    marginBottom: 8,
  },
  input: { maxHeight: 120, minHeight: 35, color: t.fg, fontSize: 14, paddingVertical: 5, textAlignVertical: "top" },
  toolbar: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    width: 32,
    height: 30,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.fill,
  },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    height: 30,
    borderRadius: 16,
    backgroundColor: t.fill,
    flexShrink: 1,
    maxWidth: 190,
  },
  model: { color: t.muted, fontSize: 11, flexShrink: 1 },
  spacer: { flex: 1 },
  action: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { backgroundColor: t.fill },
  stopSecondary: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
