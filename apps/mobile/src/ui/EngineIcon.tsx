import { useId } from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { ENGINE_MARKS } from "./engineMarks";

/** Native renderer of the same official engine marks used on the web; `tile` sets it on a rounded square. */
export function EngineIcon({
  engine,
  size = 34,
  shape = "circle",
}: {
  engine: "claude" | "codex";
  size?: number;
  shape?: "circle" | "tile";
}) {
  const gradient = `engine-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // A 10pt corner at 36pt, kept in proportion at other sizes.
  const back = (fill: string) =>
    shape === "tile" ? (
      <Rect width={24} height={24} rx={6.7} fill={fill} />
    ) : (
      <Circle cx={12} cy={12} r={12} fill={fill} />
    );
  if (engine === "claude") {
    const mark = ENGINE_MARKS.claude;
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
        {back(mark.color)}
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
      {back("#fff")}
      <Path d={mark.d} fill={`url(#${gradient})`} />
    </Svg>
  );
}
