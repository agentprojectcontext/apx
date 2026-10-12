import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import { iconNodes } from "./iconNodes";
import { useTheme } from "./theme";

export type IconName = keyof typeof iconNodes;

/** Renders the same Lucide geometry used by the web in native SVG. */
export function Icon({
  name,
  size = 20,
  color: tint,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useTheme();
  const color = tint ?? theme.muted;
  const nodes: readonly (readonly [string, Readonly<Record<string, string>>])[] = iconNodes[name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {nodes.map(([tag, attributes]) => {
        const key = `${tag}:${JSON.stringify(attributes)}`;
        switch (tag) {
          case "circle":
            return <Circle key={key} {...attributes} />;
          case "ellipse":
            return <Ellipse key={key} {...attributes} />;
          case "line":
            return <Line key={key} {...attributes} />;
          case "rect":
            return <Rect key={key} {...attributes} />;
          case "polyline":
            return <Polyline key={key} {...attributes} />;
          case "polygon":
            return <Polygon key={key} {...attributes} />;
          default:
            return <Path key={key} {...attributes} />;
        }
      })}
    </Svg>
  );
}
