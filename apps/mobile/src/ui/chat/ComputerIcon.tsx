import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { useTheme } from "../theme";

/** The pointer's path through one loop, in the icon's 24-unit grid. */
const X = [0, 2.5, -1, 0];
const Y = [0, -1.5, 1.5, 0];

/**
 * A small computer with a pointer on its screen; the pointer moves while an agent works on it (`busy`) and a couple of
 * times once it is done (`done`). The pointer is its own layer so the native driver can move it.
 */
export function ComputerIcon({
  busy = false,
  done = false,
  size = 16,
}: {
  busy?: boolean;
  done?: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const move = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!busy && !done) return;
    const once = Animated.timing(move, {
      toValue: 1,
      duration: 1600,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    const loop = Animated.loop(once, { iterations: busy ? -1 : 2, resetBeforeIteration: true });
    loop.start();
    return () => {
      loop.stop();
      move.setValue(0);
    };
  }, [busy, done, move]);
  const unit = size / 24;
  const range = [0, 0.35, 0.7, 1];
  const color = theme.brand;
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2.5" y="3.5" width="19" height="13" rx="2.5" stroke={color} strokeWidth="1.6" />
        <Path d="M9 20.5h6M12 16.5v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </Svg>
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: [
            { translateX: move.interpolate({ inputRange: range, outputRange: X.map((v) => v * unit) }) },
            { translateY: move.interpolate({ inputRange: range, outputRange: Y.map((v) => v * unit) }) },
          ],
        }}
      >
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M10 7l0 6 1.7-1.6 1.1 2.4 1.1-.5-1.1-2.3 2.3-.1z" fill={color} />
        </Svg>
      </Animated.View>
    </View>
  );
}
