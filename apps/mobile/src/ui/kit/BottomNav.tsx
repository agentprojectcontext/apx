import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "../Icon";
import { makeStyles, useTheme } from "../theme";
import { CountBadge } from "./primitives";

export type NavItem<T extends string> = { id: T; label: string; icon: IconName; badge?: number };

/** How far the center button rises over the bar. */
export const NAV_RAISE = 22;

/**
 * The tab bar: a pill behind the current tab's icon, and a red count on the tab that waits for the owner. `center`
 * sits between the two halves of the tabs, raised over the bar.
 */
export function BottomNav<T extends string>({
  items,
  value,
  onChange,
  onLongPress,
  center,
}: {
  items: Array<NavItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** A long press on a tab: its quick actions (Chats: mark all read). */
  onLongPress?: (id: T) => void;
  center?: ReactNode;
}) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const half = Math.ceil(items.length / 2);
  const tab = (item: NavItem<T>) => {
    const on = item.id === value;
    return (
      <Pressable
        key={item.id}
        accessibilityRole="tab"
        accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
        accessibilityState={{ selected: on }}
        onPress={() => onChange(item.id)}
        onLongPress={onLongPress ? () => onLongPress(item.id) : undefined}
        style={s.tab}
      >
        <View style={s.pill}>
          {/* Its own layer, mounted when active: a background swapped in place lost its radius on Android. */}
          {on ? <View style={s.pillOn} /> : null}
          <Icon name={item.icon} size={20} color={on ? t.fg : t.fgMuted} />
          {item.badge ? (
            <View style={s.badge}>
              <CountBadge count={item.badge} tone="danger" small />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[s.label, on && s.labelOn]}>
          {item.label}
        </Text>
      </Pressable>
    );
  };
  const bar = (
    <View accessibilityRole="tablist" style={[s.bar, { paddingBottom: insets.bottom }]}>
      {items.slice(0, half).map(tab)}
      {center ? <View style={s.gap} /> : null}
      {items.slice(half).map(tab)}
    </View>
  );
  if (!center) return bar;
  // The raised button overlaps the content above; elsewhere touches pass through to it.
  return (
    <View pointerEvents="box-none" style={s.raised}>
      {bar}
      <View pointerEvents="box-none" style={s.center}>
        {center}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  raised: { marginTop: -NAV_RAISE, paddingTop: NAV_RAISE },
  bar: { flexDirection: "row", backgroundColor: t.sidebar, borderTopWidth: 1, borderColor: t.border },
  gap: { flex: 1.1 },
  center: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" },
  tab: { flex: 1, height: 76, alignItems: "center", justifyContent: "center", gap: 4 },
  pill: { width: 60, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  pillOn: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 16,
    backgroundColor: t.fillStrong,
  },
  badge: { position: "absolute", top: 1, right: 10 },
  label: { color: t.fgMuted, fontSize: 12 },
  labelOn: { color: t.fg, fontWeight: "600" },
}));
