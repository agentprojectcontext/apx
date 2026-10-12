import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { initials } from "../../format";
import { Icon, type IconName } from "../Icon";
import { makeStyles, type Tone, useTheme } from "../theme";

type Size = "lg" | "md" | "sm";
const BUTTON: Record<Size, { height: number; px: number; font: number; icon: number }> = {
  lg: { height: 40, px: 18, font: 13, icon: 16 },
  md: { height: 36, px: 16, font: 13, icon: 14 },
  sm: { height: 34, px: 12, font: 12, icon: 14 },
};

/** A pill button: `primary` is the ink accent, `secondary` a quiet fill. */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  size?: Size;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  const m = BUTTON[size];
  const fg = variant === "primary" ? t.accentFg : t.fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        { height: m.height, paddingHorizontal: m.px },
        { backgroundColor: variant === "primary" ? t.accent : t.fill },
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.85 },
        style,
      ]}
    >
      {busy ? <Spinner size={m.icon} color={fg} /> : icon ? <Icon name={icon} size={m.icon} color={fg} /> : null}
      <Text
        numberOfLines={1}
        style={{ color: fg, fontSize: m.font, fontWeight: variant === "primary" ? "500" : "400" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A round 44pt touch target holding one icon. */
export function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  color,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: t.fill }, style]}
    >
      <Icon name={icon} size={size} color={color ?? t.fg} />
    </Pressable>
  );
}

/** A filter pill: outlined at rest, filled with the accent when picked. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.chip, selected && s.chipSelected]}
    >
      <Text numberOfLines={1} style={[s.chipText, selected && { color: t.accentFg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A small tinted label ("Approval", "Commitment"). */
export function Tag({ children, tone = "neutral", style }: { children: string; tone?: Tone; style?: object }) {
  const t = useTheme();
  const s = useStyles();
  const c = t.tones[tone];
  return (
    <View style={[s.tag, { backgroundColor: c.bg }, style]}>
      <Text numberOfLines={1} style={[s.tagText, { color: c.fg }]}>
        {children}
      </Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

/** Equal parts on a filled track; the picked one lifts to the surface color. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  style,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View accessibilityRole="tablist" style={[s.segment, style]}>
      {options.map((option) => {
        const on = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={[s.segmentItem, on && { backgroundColor: t.surface }]}
          >
            <Text numberOfLines={1} style={[s.segmentText, on && { fontWeight: "600" }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The panel's switch: a 44×26 track whose knob slides to the end when on. */
export function Toggle({
  value,
  onChange,
  label,
  disabled,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onChange(!value)}
      style={[
        s.toggle,
        { backgroundColor: value ? t.accent : t.fillStrong, justifyContent: value ? "flex-end" : "flex-start" },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={s.knob} />
    </Pressable>
  );
}

/** A turning arc, the same size on both platforms (ActivityIndicator only has two on iOS). */
export function Spinner({ size = 14, color: tint }: { size?: number; color?: string }) {
  const t = useTheme();
  const color = tint ?? t.fgMuted;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const r = (size - 2) / 2;
  const length = 2 * Math.PI * r;
  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={{
        width: size,
        height: size,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      }}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeOpacity={0.25} strokeWidth={1.6} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${length * 0.3} ${length}`}
        />
      </Svg>
    </Animated.View>
  );
}

/** A filled round count: brand for unread chats, danger for the nav's waiting items. */
export function CountBadge({ count, tone = "brand", small }: { count: number; tone?: Tone; small?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const h = small ? 16 : 20;
  return (
    <View
      style={[
        s.count,
        { minWidth: h, height: h, paddingHorizontal: small ? 4 : 6, backgroundColor: t.tones[tone].solid },
      ]}
    >
      <Text style={{ color: t.bg, fontSize: small ? 10 : 11, fontWeight: "600" }}>
        {count > 99 ? "99+" : String(count)}
      </Text>
    </View>
  );
}

export function Dot({ color: tint, size = 7, style }: { color?: string; size?: number; style?: object }) {
  const t = useTheme();
  const color = tint ?? t.brand;
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** A rounded square tinted with a tone, holding a row's icon. */
export function IconTile({ icon, tone = "neutral", size = 34 }: { icon: IconName; tone?: Tone; size?: number }) {
  const t = useTheme();
  const s = useStyles();
  const c = t.tones[tone];
  return (
    <View style={[s.tile, { width: size, height: size, backgroundColor: c.bg }]}>
      <Icon name={icon} size={Math.round(size * 0.53)} color={c.fg} />
    </View>
  );
}

/** The owner's initials (a person, while the core has no name), with the green dot while the phone is connected. */
export function OwnerAvatar({ name, size = 32, online }: { name: string; size?: number; online?: boolean }) {
  const t = useTheme();
  const s = useStyles();
  const letters = initials(name);
  return (
    <View style={[s.owner, { width: size, height: size, borderRadius: size / 2 }]}>
      {letters ? (
        <Text style={{ color: t.violetSoftFg, fontSize: Math.round(size * 0.36), fontWeight: "600" }}>{letters}</Text>
      ) : (
        <Icon name="UserRound" size={Math.round(size * 0.5)} color={t.violetSoftFg} />
      )}
      {online ? <View style={s.ownerDot} /> : null}
    </View>
  );
}

export function EmptyState({ title, body, icon = "Check" }: { title: string; body: string; icon?: IconName }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={22} color={t.brandSoftFg} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

/** Shared text styles of the design: titles, row copy and metadata. */
export const useType = makeStyles(
  (t) =>
    ({
      largeTitle: { color: t.fg, fontSize: 24, fontWeight: "600" },
      title: { color: t.fg, fontSize: 20, fontWeight: "600" },
      rowTitle: { color: t.fg, fontSize: 15 },
      body: { color: t.fg, fontSize: 14 },
      muted: { color: t.fgMuted, fontSize: 13 },
      meta: { color: t.fgSubtle, fontSize: 12 },
      small: { color: t.fgSubtle, fontSize: 11 },
      mono: { fontFamily: t.mono },
    }) satisfies Record<string, TextStyle>,
);

const useStyles = makeStyles((t) => ({
  button: {
    flexDirection: "row",
    gap: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.borderStrong,
    justifyContent: "center",
    maxWidth: 160,
  },
  chipSelected: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { color: t.fgMuted, fontSize: 13 },
  tag: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: "500" },
  card: { padding: 14, borderRadius: t.radiusLg, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  segment: { flexDirection: "row", gap: 2, padding: 3, borderRadius: 999, backgroundColor: t.fill },
  segmentItem: { flex: 1, height: 34, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  segmentText: { color: t.fg, fontSize: 13 },
  toggle: { width: 44, height: 26, padding: 3, borderRadius: 999, flexDirection: "row", flexShrink: 0 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.bg },
  count: { borderRadius: 999, alignItems: "center", justifyContent: "center" },
  tile: { borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  owner: { backgroundColor: t.violetSoft, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  ownerDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.brand,
    borderWidth: 2,
    borderColor: t.bg,
  },
  empty: { paddingVertical: 64, paddingHorizontal: 24, alignItems: "center", gap: 10 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { color: t.fg, fontSize: 16, fontWeight: "500", textAlign: "center" },
  emptyBody: { color: t.fgMuted, fontSize: 13, textAlign: "center" },
}));
