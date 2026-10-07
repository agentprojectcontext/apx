import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "../Icon";
import { theme as t } from "../theme";
import { CountBadge } from "./primitives";

export type NavItem<T extends string> = { id: T; label: string; icon: IconName; badge?: number };

/** The tab bar: a pill behind the current tab's icon, and a red count on the tab that waits for the owner. */
export function BottomNav<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<NavItem<T>>;
  value: T;
  onChange: (id: T) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[s.bar, { paddingBottom: insets.bottom }]}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.id)}
            style={s.tab}
          >
            <View style={[s.pill, on && { backgroundColor: t.fillStrong }]}>
              <Icon name={item.icon} size={20} color={on ? t.fg : t.fgMuted} />
              {item.badge ? (
                <View style={s.badge}>
                  <CountBadge count={item.badge} tone="danger" small />
                </View>
              ) : null}
            </View>
            <Text style={[s.label, on && s.labelOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: t.sidebar, borderTopWidth: 1, borderColor: t.border },
  tab: { flex: 1, height: 76, alignItems: "center", justifyContent: "center", gap: 4 },
  pill: { width: 60, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 10 },
  label: { color: t.fgMuted, fontSize: 12 },
  labelOn: { color: t.fg, fontWeight: "600" },
});
