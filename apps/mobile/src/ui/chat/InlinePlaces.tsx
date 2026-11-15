import { useMemo, useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import { MAP_CREDIT, mapFrame } from "../../protocol";
import { Button, Tag } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { type Of, Rating, toneOf } from "./InlineParts";

const PIN = 24;
const STEM = 7;

/** Places on a street map, a list to pick one, and the way there. */
export function Places({ node }: { node: Of<"places"> }) {
  const theme = useTheme();
  const s = useStyles();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState(node.places[0]?.id);
  const place = node.places.find((p) => p.id === picked) ?? node.places[0];
  const height = (width * 9) / 16;
  const frame = useMemo(
    () => mapFrame(node.origin ? [...node.places, node.origin] : node.places),
    [node.places, node.origin],
  );
  const spot = (p: { lat: number; lng: number }) => {
    const at = frame.at(p);
    return { x: (at.x * width) / 100, y: (at.y * height) / 100 };
  };
  const you = node.origin && width ? spot(node.origin) : undefined;
  return (
    <View style={s.stack}>
      <View style={s.map} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 &&
          frame.tiles(theme.scheme).map((tile) => (
            <Image
              key={tile.key}
              testID="map-tile"
              source={{ uri: tile.url }}
              accessibilityIgnoresInvertColors
              style={{
                position: "absolute",
                left: (tile.left * width) / 100,
                top: (tile.top * height) / 100,
                width: (tile.width * width) / 100,
                height: (tile.height * height) / 100,
              }}
            />
          ))}
        {you && (
          <View accessibilityLabel={t("inlineYouAreHere")} style={[s.you, { left: you.x - 7, top: you.y - 7 }]} />
        )}
        {node.places.map((p, i) => {
          if (!width) return null;
          const point = spot(p);
          const on = p.id === place?.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}. ${p.title}`}
              accessibilityState={{ selected: on }}
              hitSlop={8}
              onPress={() => setPicked(p.id)}
              style={[s.pin, { left: point.x - PIN / 2, top: point.y - PIN - STEM, zIndex: on ? 2 : 1 }]}
            >
              <View style={[s.pinHead, on && { backgroundColor: theme.brand }]}>
                <Text style={s.pinText}>{i + 1}</Text>
              </View>
              <View style={[s.stem, on && { backgroundColor: theme.brand }]} />
            </Pressable>
          );
        })}
        <Text style={s.note}>{MAP_CREDIT}</Text>
      </View>
      <View style={s.list}>
        {node.places.map((p, i) => {
          const on = p.id === place?.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setPicked(p.id)}
              style={[s.row, i > 0 && s.rowLine, on && s.rowOn]}
            >
              <View style={[s.number, on && { backgroundColor: theme.brand }]}>
                <Text style={s.numberText}>{i + 1}</Text>
              </View>
              <View style={s.rowBody}>
                <Text style={s.title}>{p.title}</Text>
                {p.meta && <Text style={s.meta}>{p.meta}</Text>}
              </View>
              {(p.rating || p.status) && (
                <View style={s.aside}>
                  {p.rating && <Rating value={p.rating} />}
                  {p.status && <Tag tone={toneOf(p.status.tone)}>{p.status.label}</Tag>}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      {place && (
        <View style={s.buttons}>
          <View style={s.button}>
            <Button
              label={t("inlineDirections")}
              size="sm"
              icon="MapPin"
              accessibilityHint={place.title}
              onPress={() =>
                void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`)
              }
            />
          </View>
          {place.url && (
            <View style={s.button}>
              <Button
                label={t("inlineOpen")}
                size="sm"
                variant="secondary"
                icon="ExternalLink"
                accessibilityHint={place.url}
                onPress={() => place.url && void Linking.openURL(place.url)}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  stack: { gap: 12 },
  map: {
    aspectRatio: 16 / 9,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.fill,
  },
  pin: { position: "absolute", width: PIN, alignItems: "center" },
  pinHead: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 2,
    borderColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
  },
  pinText: { color: theme.accentFg, fontSize: 11, fontWeight: "700" },
  stem: { width: 2, height: STEM, backgroundColor: theme.accent },
  you: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.surface,
    backgroundColor: theme.info,
  },
  note: {
    position: "absolute",
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderTopLeftRadius: theme.radiusSm,
    backgroundColor: theme.surface,
    color: theme.subtle,
    fontSize: 10,
    opacity: 0.85,
  },
  list: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusMd, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: theme.border },
  rowOn: { backgroundColor: theme.fill },
  number: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
  },
  numberText: { color: theme.accentFg, fontSize: 11, fontWeight: "700" },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.fg, fontSize: 14, fontWeight: "600" },
  meta: { color: theme.muted, fontSize: 12 },
  aside: { alignItems: "flex-end", gap: 4 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1 },
}));
