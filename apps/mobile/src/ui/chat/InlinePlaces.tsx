import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { t } from "../../i18n";
import { Button, Tag } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { type Of, Rating, toneOf } from "./InlineParts";

type Point = { lat: number; lng: number };
const PIN = 24;
const STEM = 7;
const COLUMNS = [1, 2, 3, 4, 5, 6, 7].map((i) => `${(i * 100) / 8}%`);
const ROWS = [1, 2, 3, 4].map((i) => `${(i * 100) / 5}%`);

/**
 * Where each point sits in a `width` × `height` box: an equirectangular sketch (longitude narrowed by latitude), one
 * scale for both axes, centred, with room for the pins' heads at the top.
 */
function project(points: Point[], width: number, height: number): { x: number; y: number }[] {
  const mid = (points.reduce((n, p) => n + p.lat, 0) / points.length) * (Math.PI / 180);
  const flat = points.map((p) => ({ x: p.lng * Math.cos(mid), y: -p.lat }));
  const xs = flat.map((p) => p.x);
  const ys = flat.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const box = { left: PIN, right: width - PIN, top: PIN + STEM + 6, bottom: height - 16 };
  const room = { x: box.right - box.left, y: box.bottom - box.top };
  const scales = [maxX > minX ? room.x / (maxX - minX) : 0, maxY > minY ? room.y / (maxY - minY) : 0].filter(Boolean);
  const scale = scales.length ? Math.min(...scales) : 0;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  return flat.map((p) => ({ x: cx + (p.x - (minX + maxX) / 2) * scale, y: cy + (p.y - (minY + maxY) / 2) * scale }));
}

/** Places on a sketched map (no tiles, nothing loaded), a list to pick one, and the way there. */
export function Places({ node }: { node: Of<"places"> }) {
  const theme = useTheme();
  const s = useStyles();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState(node.places[0]?.id);
  const place = node.places.find((p) => p.id === picked) ?? node.places[0];
  const height = (width * 9) / 16;
  const at = width ? project(node.origin ? [...node.places, node.origin] : node.places, width, height) : [];
  const you = node.origin ? at[node.places.length] : undefined;
  return (
    <View style={s.stack}>
      <View style={s.map} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Svg width="100%" height="100%" style={s.grid}>
          {COLUMNS.map((x) => (
            <Line key={x} x1={x} x2={x} y1="0" y2="100%" stroke={theme.border} strokeWidth={1} />
          ))}
          {ROWS.map((y) => (
            <Line key={y} x1="0" x2="100%" y1={y} y2={y} stroke={theme.border} strokeWidth={1} />
          ))}
        </Svg>
        {you && (
          <View accessibilityLabel={t("inlineYouAreHere")} style={[s.you, { left: you.x - 7, top: you.y - 7 }]} />
        )}
        {node.places.map((p, i) => {
          const point = at[i];
          if (!point) return null;
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
        <Text style={s.note}>{t("inlineSchematicMap")}</Text>
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
  grid: { position: "absolute", top: 0, left: 0 },
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
  note: { position: "absolute", right: 8, bottom: 6, color: theme.subtle, fontSize: 11 },
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
