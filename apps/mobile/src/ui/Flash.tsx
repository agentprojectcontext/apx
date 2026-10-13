import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { makeStyles, useTheme } from "./theme";

type Shown = { id: number; text: string; icon: IconName };

const listeners = new Set<(shown: Shown) => void>();
let last = 0;

/** A short word that something worked ("Copied", "Saved to the gallery"), in the app's own look. */
export function flash(text: string, icon: IconName = "Check"): void {
  const shown = { id: ++last, text, icon };
  for (const listen of listeners) listen(shown);
}

/**
 * Where flashes show: once at the app's root, and inside each full-screen modal (a modal covers the root, so the
 * one on top is the one seen).
 */
export function Flasher() {
  const theme = useTheme();
  const s = useStyles();
  const [shown, setShown] = useState<Shown>();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const listen = (next: Shown) => {
      setShown(next);
      opacity.stopAnimation();
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.delay(1300),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => finished && setShown((now) => (now?.id === next.id ? undefined : now)));
    };
    listeners.add(listen);
    return () => {
      listeners.delete(listen);
    };
  }, [opacity]);
  if (!shown) return null;
  return (
    <View pointerEvents="none" style={s.layer}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          s.card,
          { opacity, transform: [{ scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
        ]}
      >
        <View style={s.badge}>
          <Icon name={shown.icon} size={20} color={theme.accentFg} strokeWidth={2.4} />
        </View>
        <Text style={s.text}>{shown.text}</Text>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  card: {
    minWidth: 160,
    maxWidth: 260,
    alignItems: "center",
    gap: 10,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: theme.fg, fontSize: 15, fontWeight: "600", textAlign: "center" },
}));
