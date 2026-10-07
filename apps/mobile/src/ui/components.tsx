export { AgentAvatar, ProjectAvatar } from "./kit/avatars";

import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { theme as t } from "./theme";

export function Page({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  return scroll ? (
    <ScrollView style={s.page} contentContainerStyle={s.pageContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={s.page}>{children}</View>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
  back,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: () => void;
}) {
  return (
    <View style={s.header}>
      {back ? <IconButton icon="ChevronLeft" label="Volver" onPress={back} /> : null}
      <View style={s.headerCopy}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={s.iconButton} onPress={onPress}>
      <Icon name={icon} size={20} color={t.fg} />
    </Pressable>
  );
}

export function RoundButton({
  label,
  onPress,
  secondary = false,
  icon,
}: {
  icon?: IconName;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" style={[s.button, secondary && s.buttonSecondary]} onPress={onPress}>
      {icon ? <Icon name={icon} size={17} color={secondary ? t.fg : t.accentFg} /> : null}
      <Text style={[s.buttonText, secondary && s.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.segment}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[s.segmentItem, value === option.value && s.segmentSelected]}
        >
          <Text numberOfLines={1} style={[s.segmentText, value === option.value && s.segmentTextSelected]}>
            {option.label}
            {option.count !== undefined ? `  ${option.count}` : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "neutral" | "brand" | "violet" | "info" | "warning" | "danger";
}) {
  return (
    <View
      style={[
        s.badge,
        {
          backgroundColor: {
            neutral: t.fill,
            brand: t.brandSoft,
            violet: t.violetSoft,
            info: t.infoSoft,
            warning: t.warningSoft,
            danger: t.dangerSoft,
          }[tone],
        },
      ]}
    >
      <Text
        style={[
          s.badgeText,
          {
            color: {
              neutral: t.muted,
              brand: t.brandSoftFg,
              violet: t.violet,
              info: t.info,
              warning: t.warning,
              danger: t.danger,
            }[tone],
          },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[s.muted, style]}>
      {children}
    </Text>
  );
}
export function EmptyState({ title, body, glyph = "✓" }: { title: string; body: string; glyph?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyGlyph}>{glyph}</Text>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.muted}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.bg },
  pageContent: { paddingHorizontal: 16, paddingBottom: 24 },
  header: {
    minHeight: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: t.bg,
  },
  headerCopy: { flex: 1 },
  title: { color: t.fg, fontSize: 24, fontWeight: "600" },
  subtitle: { color: t.muted, fontSize: 12, lineHeight: 17 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  iconGlyph: { color: t.fg, fontSize: 24, lineHeight: 28 },
  button: {
    minHeight: 40,
    flexDirection: "row",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: t.accent,
  },
  buttonText: { color: t.accentFg, fontSize: 13, fontWeight: "500" },
  buttonSecondary: { backgroundColor: t.fill },
  buttonSecondaryText: { color: t.fg },
  segment: { flexDirection: "row", padding: 3, borderRadius: 999, backgroundColor: t.fill, gap: 2 },
  segmentItem: {
    minHeight: 30,
    flex: 1,
    paddingHorizontal: 11,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: { backgroundColor: t.accent },
  segmentText: { color: t.muted, fontSize: 12 },
  segmentTextSelected: { color: t.accentFg, fontWeight: "500" },
  avatar: { alignItems: "center", justifyContent: "center" },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: t.brand,
    borderWidth: 2,
    borderColor: t.bg,
  },
  projectAvatar: { alignItems: "center", justifyContent: "center" },
  badge: { alignSelf: "flex-start", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "500" },
  card: { padding: 12, borderRadius: t.radiusLg, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  muted: { color: t.muted, fontSize: 12, lineHeight: 17 },
  empty: { paddingVertical: 52, paddingHorizontal: 24, alignItems: "center", gap: 8 },
  emptyGlyph: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    color: t.brand,
    backgroundColor: t.brandSoft,
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 19,
  },
  emptyTitle: { color: t.fg, fontSize: 15, fontWeight: "500" },
});
