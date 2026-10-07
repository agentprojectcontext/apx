import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { t as translate } from "../i18n";
import type { Message } from "../protocol";
import { Icon } from "./Icon";
import { Spinner } from "./kit";
import { theme as t } from "./theme";

type ToolPart = Extract<Message["parts"][number], { type: "tool" }>;

/** Native version of the desktop's collapsible tool action group. */
export function ActionGroup({ parts, waiting = false }: { parts: ToolPart[]; waiting?: boolean }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string>();
  const running = parts.some((part) => part.status === "running");
  const failed = parts.filter((part) => part.status === "error").length;
  const one = parts.length === 1;
  const key = running
    ? waiting
      ? one
        ? "actionsWaitingOne"
        : "actionsWaiting"
      : one
        ? "actionsWorkingOne"
        : "actionsWorking"
    : one
      ? "actionsOne"
      : "actionsSummary";
  const title = translate(key, {
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
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={t.fgMuted} />
        {running ? <Spinner size={14} /> : null}
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
                  <Spinner size={12} />
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
  group: { alignSelf: "stretch", gap: 6 },
  heading: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  title: { color: t.fgMuted, fontSize: 13 },
  failed: { color: t.danger, fontSize: 12 },
  rows: { gap: 6, paddingLeft: 12, paddingRight: 4, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 },
  name: { color: t.fg, fontFamily: t.mono, fontSize: 11, maxWidth: "42%" },
  summary: { color: t.fgMuted, fontSize: 12, flex: 1 },
  detail: { color: t.fgMuted, fontSize: 11, lineHeight: 17, marginLeft: 20, paddingVertical: 6, fontFamily: t.mono },
});
