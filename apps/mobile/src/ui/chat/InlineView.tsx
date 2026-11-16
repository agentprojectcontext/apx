import { useContext, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { MediaItem } from "../../chat/media";
import { t } from "../../i18n";
import { type InlineNode, isMediaId, type InlineView as View_ } from "../../protocol";
import { BottomSheet, Button, Tag } from "../kit";
import { useMediaUri } from "../media/context";
import { MediaViewer } from "../media/MediaViewer";
import { makeStyles } from "../theme";
import { card as kitCard } from "../tokens";
import { Agenda, Code, Head, Status, Steps } from "./InlineFacts";
import { Accent, InlineAsk, inlineBox, type Of, Rating, SendButton } from "./InlineParts";
import { Booking, Choice, Compare } from "./InlinePick";
import { Places } from "./InlinePlaces";

const toItem = (src: string, alt: string): MediaItem =>
  isMediaId(src)
    ? { key: src, kind: "image", media_id: src, mime: "image/jpeg", name: alt || src }
    : { key: src, kind: "image", url: src, mime: "image/jpeg", name: alt || src };

function Picture({ node, inCard }: { node: Of<"image">; inCard: boolean }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const shown = isMediaId(node.src) ? (
    <HeldPicture node={node} inCard={inCard} />
  ) : (
    <Frame node={node} inCard={inCard} uri={node.src} />
  );
  if (!node.gallery) return shown;
  const items = node.gallery.map((g) => toItem(g, node.alt));
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={t("inlinePhotos")} onPress={() => setOpen(true)}>
        {shown}
        <View style={s.more}>
          <Text style={s.moreText}>+{node.gallery.length - 1}</Text>
        </View>
      </Pressable>
      {open && <MediaViewer items={items} start={0} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A picture APX holds, loaded through the core. */
function HeldPicture({ node, inCard }: { node: Of<"image">; inCard: boolean }) {
  const item = useMemo<MediaItem>(
    () => ({ key: node.src, kind: "image", media_id: node.src, mime: "image/jpeg", name: node.src }),
    [node.src],
  );
  return <Frame node={node} inCard={inCard} uri={useMediaUri(item).uri} />;
}

/** A picture that failed to load leaves no empty frame behind. */
function Frame({ node, inCard, uri }: { node: Of<"image">; inCard: boolean; uri?: string }) {
  const s = useStyles();
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  const style = node.shape === "thumb" ? s.thumb : [s.banner, inCard && s.bleed];
  return (
    <View style={style}>
      {uri && (
        <Image
          source={{ uri }}
          style={s.fill}
          accessibilityLabel={node.alt}
          resizeMode="cover"
          onError={() => setBroken(true)}
        />
      )}
    </View>
  );
}

/** Cards side by side to swipe through, with the one shown and how many there are. */
function Carousel({ node }: { node: Of<"grid"> }) {
  const s = useStyles();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  // Until the row is measured, a phone-sized card keeps it from drawing empty.
  const card = width ? Math.round(width * 0.86) : 300;
  const many = node.children.length > 1;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={s.carousel}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={card + 12}
        contentContainerStyle={s.track}
        onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / (card + 12)))}
        scrollEventThrottle={32}
      >
        {node.children.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a view's pieces never reorder
          <View key={i} style={{ width: many || !width ? card : width }}>
            <Piece node={c} inCard={false} />
          </View>
        ))}
      </ScrollView>
      {many && (
        <Text style={s.count}>
          {Math.min(index + 1, node.children.length)} / {node.children.length}
        </Text>
      )}
    </View>
  );
}

/** A button that opens the result's facts and longer text in a sheet, leaving the cards around as they are. */
function Details({ node }: { node: Of<"details"> }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const label = node.label ?? t("inlineDetails");
  return (
    <>
      <Button label={label} size="sm" variant="secondary" onPress={() => setOpen(true)} />
      {open && (
        <BottomSheet title={node.title ?? label} onClose={() => setOpen(false)}>
          <ScrollView contentContainerStyle={s.sheet}>{node.children.map((c, i) => draw(c, i, false))}</ScrollView>
        </BottomSheet>
      )}
    </>
  );
}

/** A card's buttons side by side; a lone button that writes to the chat is its main one. */
function Actions({ node }: { node: Of<"actions"> }) {
  const s = useStyles();
  const canAsk = Boolean(useContext(InlineAsk));
  const shown = node.children.filter((c) => c.kind !== "ask" || canAsk);
  if (!shown.length) return null;
  return (
    <View style={s.actions}>
      {shown.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a view's pieces never reorder
        <View key={i} style={s.action}>
          {c.kind === "ask" ? (
            <SendButton label={c.label} text={c.text} primary={shown.length === 1} />
          ) : (
            <Piece node={c} inCard={false} />
          )}
        </View>
      ))}
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
    case "link":
      return (
        <Button
          label={node.label}
          size="sm"
          icon="ExternalLink"
          accessibilityHint={node.url}
          onPress={() => void Linking.openURL(node.url)}
        />
      );
    case "grid":
      return <Carousel node={node} />;
    case "highlight":
      return (
        <View>
          {node.label && <Text style={s.caption}>{node.label}</Text>}
          <Text style={s.highlight}>{node.value}</Text>
        </View>
      );
    case "actions":
      return <Actions node={node} />;
    case "ask":
      return <SendButton label={node.label} text={node.text} primary={false} />;
    case "head":
      return <Head node={node} />;
    case "rating":
      return <Rating value={node.value} />;
    case "status":
      return <Status node={node} />;
    case "code":
      return <Code node={node} />;
    case "steps":
      return <Steps node={node} />;
    case "agenda":
      return <Agenda node={node} />;
    case "choice":
      return <Choice node={node} />;
    case "compare":
      return <Compare node={node} />;
    case "booking":
      return <Booking node={node} />;
    case "places":
      return <Places node={node} />;
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
  carousel: { gap: 6 },
  sheet: { gap: 12, paddingHorizontal: 16, paddingBottom: 24 },
  highlight: { color: theme.fg, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: "auto", paddingTop: 4 },
  // As wide as its label, growing to share the row; a button that does not fit goes to the next line.
  action: { flexGrow: 1 },
  more: {
    position: "absolute",
    right: 10,
    bottom: 14,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: theme.surface,
    opacity: 0.92,
  },
  moreText: { color: theme.fg, fontSize: 12, fontWeight: "600" },
  track: { gap: 12 },
  count: { alignSelf: "center", color: theme.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  column: { gap: 8 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  card: {
    ...inlineBox(theme),
    flexGrow: 1,
    gap: kitCard.gap,
    paddingHorizontal: kitCard.padX,
    paddingVertical: kitCard.padY,
  },
  banner: { aspectRatio: 16 / 9, overflow: "hidden", backgroundColor: theme.fill, borderRadius: theme.radiusSm },
  bleed: { marginTop: -kitCard.padY, marginHorizontal: -kitCard.padX, marginBottom: 4, borderRadius: 0 },
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
  fieldLabel: { color: theme.subtle, fontSize: 13, minWidth: 80, maxWidth: "40%" },
  fieldValue: { color: theme.fg, fontSize: 13, flex: 1 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 2 },
}));
