import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { blobEyes } from "./blobEyes";
import { Icon, type IconName } from "./Icon";
import { theme as t } from "./theme";

const BLOBS: Record<string, number> = {
  menta: require("../../../../packages/ui/src/blobs/bodies/menta.webp"),
  parche: require("../../../../packages/ui/src/blobs/bodies/parche.webp"),
  trino: require("../../../../packages/ui/src/blobs/bodies/trino.webp"),
  cubi: require("../../../../packages/ui/src/blobs/bodies/cubi.webp"),
  nimbo: require("../../../../packages/ui/src/blobs/bodies/nimbo.webp"),
  papa: require("../../../../packages/ui/src/blobs/bodies/papa.webp"),
  noche: require("../../../../packages/ui/src/blobs/bodies/noche.webp"),
  kiwi: require("../../../../packages/ui/src/blobs/bodies/kiwi.webp"),
  gajo: require("../../../../packages/ui/src/blobs/bodies/gajo.webp"),
  campana: require("../../../../packages/ui/src/blobs/bodies/campana.webp"),
  cobalto: require("../../../../packages/ui/src/blobs/bodies/cobalto.webp"),
  rubi: require("../../../../packages/ui/src/blobs/bodies/rubi.webp"),
  trebol: require("../../../../packages/ui/src/blobs/bodies/trebol.webp"),
  saturno: require("../../../../packages/ui/src/blobs/bodies/saturno.webp"),
  onyx: require("../../../../packages/ui/src/blobs/bodies/onyx.webp"),
  perla: require("../../../../packages/ui/src/blobs/bodies/perla.webp"),
  faro: require("../../../../packages/ui/src/blobs/bodies/faro.webp"),
  brasa: require("../../../../packages/ui/src/blobs/bodies/brasa.webp"),
  aqua: require("../../../../packages/ui/src/blobs/bodies/aqua.webp"),
  coral: require("../../../../packages/ui/src/blobs/bodies/coral.webp"),
  zafiro: require("../../../../packages/ui/src/blobs/bodies/zafiro.webp"),
  pino: require("../../../../packages/ui/src/blobs/bodies/pino.webp"),
  eclipse: require("../../../../packages/ui/src/blobs/bodies/eclipse.webp"),
  peon: require("../../../../packages/ui/src/blobs/bodies/peon.webp"),
  ovni: require("../../../../packages/ui/src/blobs/bodies/ovni.webp"),
  amatista: require("../../../../packages/ui/src/blobs/bodies/amatista.webp"),
  volcan: require("../../../../packages/ui/src/blobs/bodies/volcan.webp"),
  quad: require("../../../../packages/ui/src/blobs/bodies/quad.webp"),
  cometa: require("../../../../packages/ui/src/blobs/bodies/cometa.webp"),
  lila: require("../../../../packages/ui/src/blobs/bodies/lila.webp"),
  orbita: require("../../../../packages/ui/src/blobs/bodies/orbita.webp"),
  caracol: require("../../../../packages/ui/src/blobs/bodies/caracol.webp"),
  iris: require("../../../../packages/ui/src/blobs/bodies/iris.webp"),
  laguna: require("../../../../packages/ui/src/blobs/bodies/laguna.webp"),
  carbon: require("../../../../packages/ui/src/blobs/bodies/carbon.webp"),
};

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

export function AgentAvatar({
  name,
  blob,
  id,
  size = 34,
  online = false,
}: {
  name: string;
  blob?: string;
  id?: string;
  size?: number;
  online?: boolean;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "A";
  const seed = id ?? name;
  const hash = [...seed].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  const blobName = blob || Object.keys(BLOBS)[hash % Object.keys(BLOBS).length];
  const hue = hash % 8;
  const colors = ["#23453b", "#392b51", "#26384d", "#493128", "#492d3c", "#274147", "#47402a", "#3e2e48"];
  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      {blobName && BLOBS[blobName] ? (
        <Image source={BLOBS[blobName]} resizeMode="contain" style={{ width: size, height: size }} />
      ) : (
        <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[hue] }]}>
          <Text style={{ color: t.fg, fontSize: size * 0.34, fontWeight: "600" }}>{initials}</Text>
        </View>
      )}
      {blobName && BLOBS[blobName]
        ? blobEyes[blobName]?.eyes.map((eye) => (
            <View
              key={`${eye.x}:${eye.y}`}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: (eye.x * size) / 256,
                top: (eye.y * size) / 256,
                width: (eye.w * size) / 256,
                height: (eye.h * size) / 256,
                borderRadius: (eye.rx * size) / 256,
                backgroundColor: blobEyes[blobName]?.color,
              }}
            />
          ))
        : null}
      {online ? <View style={s.onlineDot} /> : null}
    </View>
  );
}

export function ProjectAvatar({ name, color = t.brand, size = 22 }: { name: string; color?: string; size?: number }) {
  return (
    <View
      style={[
        s.projectAvatar,
        { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: color },
      ]}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.52, fontWeight: "600" }}>{name[0]?.toUpperCase() ?? "?"}</Text>
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
