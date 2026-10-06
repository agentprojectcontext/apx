import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { t as translate } from "../i18n";
import type { Message } from "../protocol";
import { Icon } from "./Icon";
import { theme as t } from "./theme";

type ToolPart = Extract<Message["parts"][number], { type: "tool" }>;

/** Native version of the desktop's collapsible tool action group. */
export function ActionGroup({ parts, waiting = false }: { parts: ToolPart[]; waiting?: boolean }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string>();
  const running = parts.some((part) => part.status === "running");
  const failed = parts.filter((part) => part.status === "error").length;
  const title = translate(running ? (waiting ? "actionsWaiting" : "actionsWorking") : "actionsSummary", {
    n: String(parts.length),
  });
  return (
    <View style={s.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={s.heading}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={t.subtle} />
        {running ? <ActivityIndicator size={14} color={t.muted} /> : <Icon name="Wrench" size={14} color={t.subtle} />}
        <Text style={s.title}>{title}</Text>
        {failed > 0 ? <Text style={s.failed}>{translate("actionsFailed", { n: String(failed) })}</Text> : null}
      </Pressable>
      {open ? (
        <View style={s.rows}>
          {parts.map((part) => (
            <View key={part.call_id}>
              <Pressable
                onPress={() =>
                  part.detail && setDetail((current) => (current === part.call_id ? undefined : part.call_id))
                }
                disabled={!part.detail}
                style={s.row}
              >
                {part.status === "running" ? (
                  <ActivityIndicator size={12} color={t.muted} />
                ) : (
                  <Icon
                    name={part.status === "error" ? "X" : "Check"}
                    size={13}
                    color={part.status === "error" ? t.danger : t.brand}
                    strokeWidth={2.5}
                  />
                )}
                <Text style={s.name} numberOfLines={1}>
                  {part.tool}
                </Text>
                <Text style={[s.summary, part.status === "error" && s.failed]} numberOfLines={1}>
                  {part.title}
                </Text>
              </Pressable>
              {detail === part.call_id && part.detail ? (
                <Text selectable style={s.detail}>
                  {part.detail}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  group: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.fill,
    alignSelf: "stretch",
    marginBottom: 4,
  },
  heading: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexWrap: "wrap",
  },
  title: { color: t.fg, fontSize: 12, fontWeight: "500" },
  failed: { color: t.danger, fontSize: 11 },
  rows: { gap: 6, paddingLeft: 30, paddingRight: 12, paddingBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  name: { color: t.fg, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, maxWidth: "42%" },
  summary: { color: t.muted, fontSize: 11, flex: 1 },
  detail: { color: t.muted, fontSize: 11, lineHeight: 17, marginLeft: 20, paddingVertical: 6 },
});
