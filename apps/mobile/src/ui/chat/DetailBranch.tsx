import type { ReactNode } from "react";
import { View } from "react-native";
import { makeStyles } from "../theme";

/** Connects a disclosure to its supporting content without adding a focus stop. */
export function DetailBranch({ children, straight = false }: { children: ReactNode; straight?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.wrap}>
      <View
        testID="detail-guide"
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={straight ? s.straight : s.curve}
      />
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { marginLeft: 8, paddingLeft: 16, paddingVertical: 2, gap: 4 },
  straight: { position: "absolute", left: 0, top: 0, bottom: 0, borderLeftWidth: 1, borderColor: t.border },
  curve: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 12,
    height: 14,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 8,
    borderColor: t.border,
  },
}));
