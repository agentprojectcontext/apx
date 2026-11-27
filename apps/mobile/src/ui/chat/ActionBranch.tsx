import type { ReactNode } from "react";
import { View } from "react-native";
import { makeStyles } from "../theme";

/** Keeps each nested action connected, with the last branch ending at its label. */
export function ActionBranch({
  children,
  last,
  compact,
  enabled = true,
}: {
  children: ReactNode;
  last: boolean;
  compact: boolean;
  enabled?: boolean;
}) {
  const s = useStyles();
  if (!enabled) return children;
  return (
    <View style={s.wrap}>
      <View
        testID="action-guide"
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={s.guide}
      >
        {!last ? <View style={s.stem} /> : null}
        <View style={[s.curve, compact && s.compactCurve]} />
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { paddingLeft: 16 },
  guide: { position: "absolute", left: 0, top: 0, bottom: 0, width: 12 },
  stem: { position: "absolute", left: 0, top: 0, bottom: 0, borderLeftWidth: 1, borderColor: t.border },
  curve: {
    width: 12,
    height: 24,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 8,
    borderColor: t.border,
  },
  compactCurve: { height: 16 },
}));
