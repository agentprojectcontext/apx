import { useId } from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { ENGINE_MARKS } from "./engineMarks";

/** Native renderer of the same official engine marks used on the web. */
export function EngineIcon({ engine, size = 34 }: { engine: "claude" | "codex"; size?: number }) {
  const gradient = `engine-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  if (engine === "claude") {
    const mark = ENGINE_MARKS.claude;
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        <Circle cx={12} cy={12} r={12} fill={mark.color} />
        <Path d={mark.d} fill="#fff" transform="translate(4.2 4.2) scale(0.65)" />
      </Svg>
    );
  }
  const mark = ENGINE_MARKS.codex;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Defs>
        <LinearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={12} x2={12} y1={3} y2={21}>
          <Stop stopColor={mark.from} />
          <Stop offset="0.5" stopColor={mark.via} />
          <Stop offset="1" stopColor={mark.to} />
        </LinearGradient>
      </Defs>
      <Circle cx={12} cy={12} r={12} fill="#fff" />
      <Path d={mark.d} fill={`url(#${gradient})`} />
    </Svg>
  );
}
