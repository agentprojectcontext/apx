import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";
import { t } from "../../i18n";
import { makeStyles, useTheme } from "../theme";

/** Each tile's start in the loop, in seconds: the picture forms from the middle out, as on the web. */
const DELAYS = [
  0.85, 0.55, 0.4, 0.55, 0.85, 0.55, 0.3, 0.16, 0.3, 0.55, 0.4, 0.16, 0, 0.08, 0.4, 0.55, 0.3, 0.08, 0.16, 0.55, 0.85,
  0.55, 0.4, 0.55, 0.85,
];
const LOOP_S = 3.3;
const STEPS = [0, 0.08, 0.22, 0.58, 0.78, 1];

/** Where a picture is being made: a 5×5 grid of tiles that form and fade in turns. */
export function ImageGenerating() {
  const theme = useTheme();
  const s = useStyles();
  const clock = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => live && setStill(reduce));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(clock, { toValue: 1, duration: LOOP_S * 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, still]);
  const ease = Easing.bezier(0.18, 0.75, 0.23, 1);
  return (
    <View style={s.box} accessibilityRole="progressbar" accessibilityLabel={t("imageGenerating")}>
      <View style={s.grid}>
        {DELAYS.map((delay, index) => {
          const nth = index + 1;
          const color = nth % 5 === 0 ? theme.brandSoft : nth % 3 === 0 ? theme.brandSoftFg : theme.brand;
          const phase = Animated.modulo(Animated.add(clock, 1 - delay / LOOP_S), 1);
          const style = still
            ? { opacity: 0.55 }
            : {
                opacity: phase.interpolate({ inputRange: STEPS, outputRange: [0, 0, 0.84, 0.84, 0, 0], easing: ease }),
                transform: [
                  {
                    scale: phase.interpolate({
                      inputRange: STEPS,
                      outputRange: [0.36, 0.36, 1, 1, 0.92, 0.92],
                      easing: ease,
                    }),
                  },
                ],
              };
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional tiles
          return <Animated.View key={index} style={[s.tile, { backgroundColor: color }, style]} />;
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  box: {
    width: 184,
    height: 184,
    overflow: "hidden",
    borderRadius: theme.radiusMd,
    backgroundColor: theme.brandSoft,
    marginVertical: 8,
    padding: 4,
  },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 3 },
  // Five across: (184 - 2·4 padding - 4·3 gaps) / 5.
  tile: { width: 32.8, height: 32.8, borderRadius: 4 },
}));
