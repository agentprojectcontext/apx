import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { t } from "../../i18n";
import { Tag } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { card as kitCard } from "../tokens";
import { fill, inlineBox, type Of, Rating, SendButton, Stepper, Tile, toneOf } from "./InlineParts";

/** One option to pick with its price, how many, and a button that asks the agent for it. */
export function Choice({ node }: { node: Of<"choice"> }) {
  const theme = useTheme();
  const s = useStyles();
  const [picked, setPicked] = useState<string>();
  const [quantity, setQuantity] = useState(1);
  const option = node.options.find((o) => o.id === picked);
  const tiles = node.options.some((o) => o.image);
  const template = node.submit.ask ?? (option?.price ? t("inlineChooseAsk") : t("inlineChooseAskNoPrice"));
  const vars = { option: option?.title ?? "", quantity, price: option?.price ?? "" };
  return (
    <View style={s.stack}>
      <View accessibilityRole="radiogroup" style={s.options}>
        {node.options.map((o) => {
          const on = o.id === picked;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={[o.title, o.price].filter(Boolean).join(", ")}
              onPress={() => setPicked(o.id)}
              style={[s.option, on && s.optionOn]}
            >
              <View style={[s.radio, on && { borderColor: theme.brand }]}>{on && <View style={s.radioDot} />}</View>
              {tiles && <Tile src={o.image} title={o.title} />}
              <View style={s.optionBody}>
                <View style={s.optionTitle}>
                  <Text style={s.title}>{o.title}</Text>
                  {o.badge && <Tag tone={toneOf(o.badge.tone)}>{o.badge.label}</Tag>}
                </View>
                {o.description && <Text style={s.sub}>{o.description}</Text>}
                {o.rating && <Rating value={o.rating} />}
              </View>
              {o.price && (
                <View style={s.price}>
                  {o.was && <Text style={s.was}>{o.was}</Text>}
                  <Text style={s.priceText}>{o.price}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={s.checkout}>
        <View style={s.sumRow}>
          <View style={s.sum}>
            <Text style={option ? s.title : s.sub} numberOfLines={2}>
              {option ? (node.quantity ? `${option.title} × ${quantity}` : option.title) : t("inlineChooseOption")}
            </Text>
            {option?.price && <Text style={s.sub}>{option.price}</Text>}
          </View>
          {node.quantity && <Stepper value={quantity} min={1} max={node.quantity} onChange={setQuantity} />}
        </View>
        <SendButton label={fill(node.submit.label, vars)} text={fill(template, vars)} disabled={!option} />
      </View>
    </View>
  );
}

/** Options side by side, one column each, sliding sideways on a phone; a header picks one. */
export function Compare({ node }: { node: Of<"compare"> }) {
  const s = useStyles();
  const [picked, setPicked] = useState(node.picked);
  const column = picked === undefined ? undefined : node.columns[picked];
  const vars = { option: column?.title ?? "" };
  return (
    <View style={s.stack}>
      <ScrollView horizontal style={s.vsScroll} contentContainerStyle={s.vsContent}>
        <View style={s.vs}>
          <View style={s.vsRow}>
            <View style={s.vsLabel} />
            {node.columns.map((c, i) => (
              <Pressable
                key={c.title}
                accessibilityRole="button"
                accessibilityState={{ selected: i === picked }}
                onPress={() => setPicked(i)}
                style={[s.vsCell, s.vsHead, i === picked && s.vsPicked]}
              >
                <Text style={s.title}>{c.title}</Text>
                {c.subtitle && <Text style={s.sub}>{c.subtitle}</Text>}
                {c.badge && <Tag tone={toneOf(c.badge.tone)}>{c.badge.label}</Tag>}
              </Pressable>
            ))}
          </View>
          {node.rows.map((r) => (
            <View key={r.label} style={[s.vsRow, s.vsLine]}>
              <View style={s.vsLabel}>
                <Text style={s.vsLabelText}>{r.label}</Text>
              </View>
              {r.values.map((v, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a row's cells follow its columns
                <View key={i} style={[s.vsCell, i === picked && s.vsPicked]}>
                  <Text style={r.best.includes(i) ? s.best : s.cellText}>{v}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {node.submit && (
        <SendButton
          label={column ? fill(node.submit.label, vars) : t("inlineChooseOption")}
          text={fill(node.submit.ask ?? t("inlineCompareAsk"), vars)}
          disabled={!column}
        />
      )}
    </View>
  );
}

type Slot = Of<"booking">["days"][number];

function Slots({
  label,
  slots,
  picked,
  onPick,
  tall,
}: {
  label: string;
  slots: Slot[];
  picked?: number;
  onPick: (i: number) => void;
  tall?: boolean;
}) {
  const s = useStyles();
  return (
    <View style={s.slotGroup}>
      <Text style={s.groupLabel}>{label}</Text>
      <View style={s.slots}>
        {slots.map((slot, i) => {
          const on = i === picked;
          return (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: slots keep their order
              key={i}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: slot.off }}
              accessibilityLabel={[slot.label, slot.sub].filter(Boolean).join(" ")}
              disabled={slot.off}
              onPress={() => onPick(i)}
              style={[s.slot, tall && s.slotTall, on && s.slotOn, slot.off && s.slotOff]}
            >
              <Text style={[s.slotText, on && s.slotTextOn, slot.off && s.struck]}>{slot.label}</Text>
              {slot.sub && <Text style={[s.slotSub, slot.off && s.struck]}>{slot.sub}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A day and a time to book, for how many, and a button that asks the agent to book it. */
export function Booking({ node }: { node: Of<"booking"> }) {
  const s = useStyles();
  const [day, setDay] = useState<number>();
  const [time, setTime] = useState<number>();
  const [people, setPeople] = useState(node.people?.value ?? 1);
  const d = day === undefined ? undefined : node.days[day];
  const at = time === undefined ? undefined : node.times[time];
  const dayText = d ? [d.label, d.sub].filter(Boolean).join(" ") : "";
  const peopleText = node.people ? t("inlinePeople", { n: people }) : "";
  const vars = { day: dayText, time: at?.label ?? "", people: peopleText, what: node.what };
  const template = node.submit.ask ?? (node.people ? t("inlineBookAsk") : t("inlineBookAskAlone"));
  return (
    <View style={s.stack}>
      <Slots label={t("inlineDay")} slots={node.days} picked={day} onPick={setDay} tall />
      <Slots label={t("inlineTime")} slots={node.times} picked={time} onPick={setTime} />
      <View style={s.checkout}>
        <View style={s.sumRow}>
          <View style={s.sum}>
            <Text style={d && at ? s.title : s.sub}>
              {d && at ? [dayText, at.label, peopleText].filter(Boolean).join(" · ") : t("inlineChooseTime")}
            </Text>
            {node.note && <Text style={s.sub}>{node.note}</Text>}
          </View>
          {node.people && <Stepper value={people} min={node.people.min} max={node.people.max} onChange={setPeople} />}
        </View>
        <SendButton label={fill(node.submit.label, vars)} text={fill(template, vars)} disabled={!d || !at} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  stack: { gap: 12 },
  options: { gap: 6 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: kitCard.optionPadX,
    paddingVertical: kitCard.optionPadY,
    ...inlineBox(theme),
  },
  // A thicker brand edge stands in for the panel's ring; the padding keeps the row from shifting.
  optionOn: {
    borderWidth: 2,
    borderColor: theme.brand,
    paddingHorizontal: kitCard.optionPadX - 1,
    paddingVertical: kitCard.optionPadY - 1,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.brand },
  optionBody: { flex: 1, minWidth: 0, gap: 2 },
  optionTitle: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { color: theme.fg, fontSize: 14, fontWeight: "600" },
  sub: { color: theme.muted, fontSize: 12 },
  // The old price over the new one: side by side they took half a narrow phone's row and cut the badge.
  price: { alignItems: "flex-end", flexShrink: 0 },
  priceText: { color: theme.fg, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  was: { color: theme.subtle, fontSize: 12, textDecorationLine: "line-through", fontVariant: ["tabular-nums"] },
  checkout: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border },
  sumRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sum: { flex: 1, minWidth: 0, gap: 2 },
  // A sideways ScrollView grows by default; the table keeps its own height.
  vsScroll: { flexGrow: 0 },
  vsContent: { flexGrow: 1 },
  vs: { ...inlineBox(theme), flexGrow: 1 },
  vsRow: { flexDirection: "row" },
  vsLine: { borderTopWidth: 1, borderTopColor: theme.border },
  vsLabel: { width: 96, paddingHorizontal: 12, paddingVertical: 10 },
  vsLabelText: { color: theme.subtle, fontSize: 13, fontWeight: "500" },
  vsCell: { flex: 1, minWidth: 120, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  vsHead: { justifyContent: "flex-end", alignItems: "flex-start" },
  vsPicked: { backgroundColor: theme.fill },
  cellText: { color: theme.fg, fontSize: 13 },
  best: { color: theme.brandSoftFg, fontSize: 13, fontWeight: "600" },
  slotGroup: { gap: 6 },
  groupLabel: { color: theme.muted, fontSize: 12, fontWeight: "600" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  slot: {
    minWidth: 72,
    height: 34,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface,
  },
  slotTall: { height: 46, gap: 2 },
  slotOn: { borderColor: theme.brand, backgroundColor: theme.brandSoft },
  slotOff: { opacity: 0.6 },
  slotText: { color: theme.fg, fontSize: 13, fontVariant: ["tabular-nums"] },
  slotTextOn: { color: theme.brandSoftFg, fontWeight: "600" },
  slotSub: { color: theme.subtle, fontSize: 11 },
  struck: { color: theme.subtle, textDecorationLine: "line-through" },
}));
