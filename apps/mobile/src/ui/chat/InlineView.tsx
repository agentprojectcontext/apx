import { useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { MediaItem } from "../../chat/media";
import { t } from "../../i18n";
import type { InlineNode, InlineView as View_ } from "../../protocol";
import { Icon } from "../Icon";
import { Tag } from "../kit";
import { useMediaUri } from "../media/context";
import { makeStyles, useTheme } from "../theme";

type Of<K extends InlineNode["kind"]> = Extract<InlineNode, { kind: K }>;

/** APX Kit's accent: a thin brand-to-violet line on top of each card. */
function Accent() {
  const theme = useTheme();
  return (
    <Svg width="100%" height={3} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      <Defs>
        <LinearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={theme.brand} />
          <Stop offset="1" stopColor={theme.violet} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height={3} fill="url(#accent)" />
    </Svg>
  );
}

function Picture({ node, inCard }: { node: Of<"image">; inCard: boolean }) {
  const s = useStyles();
  const item = useMemo<MediaItem>(
    () => ({ key: node.media, kind: "image", media_id: node.media, mime: "image/jpeg", name: node.media }),
    [node.media],
  );
  const { uri } = useMediaUri(item);
  const style = node.shape === "thumb" ? s.thumb : [s.banner, inCard && s.bleed];
  return (
    <View style={style}>
      {uri && <Image source={{ uri }} style={s.fill} accessibilityLabel={node.alt} resizeMode="cover" />}
    </View>
  );
}

function Details({ node }: { node: Of<"details"> }) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={s.details}>
      <Pressable
        style={s.summary}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.subtle} />
        <Text style={s.summaryText}>{node.label ?? t("inlineDetails")}</Text>
      </Pressable>
      {open && <View style={s.detailsBody}>{node.children.map((c, i) => draw(c, i, false))}</View>}
    </View>
  );
}

function Piece({ node, inCard }: { node: InlineNode; inCard: boolean }) {
  const s = useStyles();
  switch (node.kind) {
    case "text":
      return <Text style={s[node.style]}>{node.text}</Text>;
    case "image":
      return <Picture node={node} inCard={inCard} />;
    case "badges":
      return (
        <View style={s.badges}>
          {node.items.map((item) => (
            <Tag key={item}>{item}</Tag>
          ))}
        </View>
      );
    case "fields":
      return (
        <View style={s.fields}>
          {node.rows.map((row) => (
            <View key={row.label} style={s.field}>
              <Text style={s.fieldLabel}>{row.label}</Text>
              <Text style={s.fieldValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      );
    case "details":
      return <Details node={node} />;
    case "divider":
      return <View style={s.divider} />;
    case "card":
      return (
        <View style={s.card}>
          <Accent />
          {node.children.map((c, i) => draw(c, i, true))}
        </View>
      );
    case "row":
      return <View style={s.row}>{node.children.map((c, i) => draw(c, i, false))}</View>;
    default:
      // On a phone a grid is one card under another.
      return (
        <View style={node.kind === "column" && inCard ? s.column : s.stack}>
          {node.children.map((c, i) => draw(c, i, inCard && i === 0))}
        </View>
      );
  }
}

// A view's pieces never reorder, so their place is their key; only a card's first picture bleeds to its edges.
const draw = (node: InlineNode, i: number, inCard: boolean) => <Piece key={i} node={node} inCard={inCard && i === 0} />;

/** An ```apx-cards or ```a2ui block as APX cards, as the panel draws it. */
export function InlineView({ view }: { view: View_ }) {
  const s = useStyles();
  return (
    <View style={s.view} accessibilityLabel={view.title}>
      {(view.title || view.example) && (
        <View style={s.head}>
          {view.title && <Text style={s.heading}>{view.title}</Text>}
          {view.example && <Tag>{t("inlineExample")}</Tag>}
        </View>
      )}
      {draw(view.root, 0, false)}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  view: { alignSelf: "stretch", gap: 10, marginVertical: 4 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  heading: { color: theme.fg, fontSize: 15, fontWeight: "600" },
  stack: { gap: 12 },
  column: { gap: 8 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  card: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
  },
  banner: { aspectRatio: 16 / 9, overflow: "hidden", backgroundColor: theme.fill, borderRadius: theme.radiusSm },
  bleed: { marginTop: -14, marginHorizontal: -16, marginBottom: 4, borderRadius: 0 },
  thumb: {
    width: 76,
    aspectRatio: 2 / 3,
    overflow: "hidden",
    backgroundColor: theme.fill,
    borderRadius: theme.radiusSm,
  },
  fill: { width: "100%", height: "100%" },
  eyebrow: { color: theme.muted, fontSize: 12, fontWeight: "600" },
  title: { color: theme.fg, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  body: { color: theme.muted, fontSize: 13.5, lineHeight: 19 },
  caption: { color: theme.subtle, fontSize: 12 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fields: { gap: 6 },
  field: { flexDirection: "row", gap: 16 },
  fieldLabel: { color: theme.subtle, fontSize: 13, minWidth: 80 },
  fieldValue: { color: theme.fg, fontSize: 13, flex: 1 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 2 },
  details: { borderRadius: theme.radiusMd, backgroundColor: theme.fill },
  summary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  summaryText: { color: theme.fg, fontSize: 13, fontWeight: "600" },
  detailsBody: { gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
}));
