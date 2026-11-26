import { type ReactNode, type Ref, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { makeStyles, useTheme } from "../theme";

/** A quiet chat line with a full-size touch target; only its detail folds. */
export function CompactRow({
  title,
  icon,
  children,
  warning = false,
  summary,
  feedback,
  headingRef,
}: {
  title: string;
  summary?: string;
  icon: IconName;
  children?: ReactNode;
  warning?: boolean;
  feedback?: ReactNode;
  headingRef?: Ref<View>;
}) {
  const [open, setOpen] = useState(false);
  const s = useStyles();
  const theme = useTheme();
  const color = warning ? theme.warning : theme.fgMuted;
  const heading = (
    <>
      <Icon name={icon} size={14} color={color} />
      <Text style={s.title}>
        {title}
        {summary ? (
          <>
            {" "}
            · <Text>{summary}</Text>
          </>
        ) : null}
      </Text>
      {children ? <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={color} /> : null}
    </>
  );
  return (
    <View style={s.wrap}>
      <View style={s.line}>
        {children ? (
          <Pressable
            ref={headingRef}
            accessibilityRole="button"
            accessibilityLabel={summary ? `${title} · ${summary}` : title}
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((value) => !value)}
            style={s.heading}
          >
            {heading}
          </Pressable>
        ) : (
          <View style={s.heading}>{heading}</View>
        )}
      </View>
      {feedback}
      {open ? <View style={s.detail}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: { alignSelf: "stretch" },
  line: { flexDirection: "row", alignItems: "center" },
  heading: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2, flexShrink: 1 },
  title: { fontSize: 13, color: theme.fgMuted, flexShrink: 1 },
  detail: { marginLeft: 8, paddingLeft: 12, paddingVertical: 4, borderLeftWidth: 1, borderColor: theme.border, gap: 8 },
}));
