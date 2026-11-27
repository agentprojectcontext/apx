import { type ReactNode, type Ref, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../Icon";
import { makeStyles, useTheme } from "../theme";
import { DetailBranch } from "./DetailBranch";
import { useActionDensity } from "./useActionDensity";

/** A quiet chat line; only supporting detail folds. */
export function CompactRow({
  title,
  icon,
  children,
  warning = false,
  summary,
  feedback,
  headingRef,
  compact = false,
  branch = true,
  trailing,
  straight = false,
  leading,
  label,
  initiallyOpen = false,
  expanded,
  onExpandedChange,
  nested = false,
}: {
  title: string;
  summary?: string;
  icon?: IconName;
  leading?: ReactNode;
  label?: string;
  initiallyOpen?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  nested?: boolean;
  children?: ReactNode;
  warning?: boolean;
  feedback?: ReactNode;
  headingRef?: Ref<View>;
  compact?: boolean;
  branch?: boolean;
  trailing?: ReactNode;
  straight?: boolean;
}) {
  const [localOpen, setOpen] = useState(initiallyOpen);
  const open = expanded ?? localOpen;
  const s = useStyles();
  const theme = useTheme();
  const dense = useActionDensity();
  const color = warning ? theme.warning : theme.fgMuted;
  const heading = (
    <>
      {children ? <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={color} /> : null}
      {leading ?? (icon ? <Icon name={icon} size={14} color={color} /> : null)}
      <Text style={s.title}>
        {title}
        {summary ? (
          <>
            {" "}
            · <Text>{summary}</Text>
          </>
        ) : null}
      </Text>
    </>
  );
  return (
    <View style={s.wrap}>
      <View style={s.line}>
        {children ? (
          <Pressable
            ref={headingRef}
            accessibilityRole="button"
            accessibilityLabel={label ?? (summary ? `${title} · ${summary}` : title)}
            accessibilityState={{ expanded: open }}
            onPress={() => {
              setOpen(!open);
              onExpandedChange?.(!open);
            }}
            style={[
              s.heading,
              compact && s.compactHeading,
              compact && dense && s.denseHeading,
              nested && dense && s.nestedHeading,
            ]}
          >
            {heading}
          </Pressable>
        ) : (
          <View
            accessible={!!label}
            accessibilityRole={label ? "text" : undefined}
            accessibilityLabel={label}
            style={[s.heading, compact && s.staticHeading]}
          >
            {heading}
          </View>
        )}
        {trailing}
      </View>
      {feedback}
      {open ? (
        branch ? (
          <DetailBranch straight={straight}>{children}</DetailBranch>
        ) : (
          <View style={s.branches}>{children}</View>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: { alignSelf: "stretch" },
  branches: { marginLeft: 8 },
  line: { flexDirection: "row", alignItems: "center" },
  heading: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2, flexShrink: 1 },
  compactHeading: { flex: 1 },
  denseHeading: { minHeight: 34 },
  staticHeading: { minHeight: 28 },
  nestedHeading: { minHeight: 32 },
  title: { fontSize: 13, color: theme.fgMuted, flexShrink: 1 },
}));
