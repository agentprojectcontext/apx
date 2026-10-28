import { type ComponentType, useId } from "react";
import Svg, { Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { CHANNEL_MARKS, type ChannelBrand, type MarkArt, type MarkNode } from "./channelMarks";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

// biome-ignore lint/suspicious/noExplicitAny: each tag takes its own SVG props, filled from the mark's attributes
const TAGS: Record<string, ComponentType<any>> = {
  path: Path,
  g: G,
  defs: Defs,
  linearGradient: LinearGradient,
  radialGradient: RadialGradient,
  stop: Stop,
  mask: Mask,
  rect: Rect,
};

export const isChannelBrand = (type: string | undefined): type is ChannelBrand =>
  Boolean(type && type in CHANNEL_MARKS);

/** A chat app's own mark (Telegram, WhatsApp…), as on the web; an unknown app, a chat bubble. */
export function ChannelMark({ type, size = 16 }: { type: string | undefined; size?: number }) {
  const theme = useTheme();
  const prefix = `m${useId().replace(/[^\w]/g, "")}`;
  if (!isChannelBrand(type)) return <Icon name="MessageCircle" size={size} color={theme.fgMuted} />;
  const mark = CHANNEL_MARKS[type];
  if ("art" in mark) {
    const art = mark as MarkArt;
    const draw = (node: MarkNode, key: number) => {
      const Tag = TAGS[node.t];
      if (!Tag) return null;
      const props = Object.fromEntries(
        Object.entries(node.a).map(([name, value]) => [name, value.replaceAll("{id}", prefix)]),
      );
      return (
        <Tag key={key} {...props}>
          {node.c?.map(draw)}
        </Tag>
      );
    };
    return (
      <Svg width={size} height={size} viewBox={art.viewBox}>
        {art.art.map(draw)}
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {mark.paths.map((path) => (
        <Path key={path.d.slice(0, 16)} d={path.d} fill={path.color ?? theme.fg} />
      ))}
    </Svg>
  );
}
