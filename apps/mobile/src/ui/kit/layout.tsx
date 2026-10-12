import { Children, Fragment, isValidElement } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t as tr } from "../../i18n";
import { Icon, type IconName } from "../Icon";
import { makeStyles, useTheme } from "../theme";
import { IconButton, useType } from "./primitives";

/**
 * A tab's body: a fixed `header` (title, filters) and the content that scrolls under it — only the list moves.
 * `inset` pads the sides (cards); lists that run edge to edge leave it off.
 */
export function Screen({
  children,
  header,
  inset = true,
  gap = 12,
  bottom = 24,
  refreshControl,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  inset?: boolean;
  gap?: number;
  bottom?: number;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const s = useStyles();
  const body = (
    <ScrollView
      style={s.screen}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: inset ? 16 : 0,
        paddingTop: header ? 4 : 0,
        paddingBottom: bottom,
        gap,
      }}
    >
      {children}
    </ScrollView>
  );
  if (!header) return body;
  return (
    <View style={s.screen}>
      <View style={{ paddingHorizontal: inset ? 16 : 0, paddingBottom: 8, gap: 8 }}>{header}</View>
      {body}
    </View>
  );
}

/** A tab's large title, with an optional line under it and actions on the right. */
export function PageTitle({
  title,
  subtitle,
  right,
  inset = false,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Inside an edge-to-edge list: pad like the rows (20). */
  inset?: boolean;
}) {
  const type = useType();
  const s = useStyles();
  return (
    <View style={[s.pageTitle, { paddingHorizontal: inset ? 20 : 4 }]}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={type.largeTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={type.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A pushed page's header: back, a 20pt title and a short summary on the right. */
export function SubHeader({ title, back, right }: { title: string; back: () => void; right?: React.ReactNode }) {
  const type = useType();
  const s = useStyles();
  return (
    <View style={s.subHeader}>
      <IconButton icon="ChevronLeft" label={tr("back")} size={22} onPress={back} />
      <Text accessibilityRole="header" numberOfLines={1} style={[type.title, { flex: 1 }]}>
        {title}
      </Text>
      {typeof right === "string" ? (
        <Text style={[type.meta, { marginRight: 12 }]}>{right}</Text>
      ) : right ? (
        <View style={{ marginRight: 16 }}>{right}</View>
      ) : null}
    </View>
  );
}

/** Rows on one card, split by hairlines. */
export function ListGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[s.group, style]}>
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? <View style={s.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A tappable row: leading element, label, detail and a chevron. */
export function ListRow({
  label,
  detail,
  detailColor,
  leading,
  onPress,
  chevron = true,
  trailing,
  sub,
}: {
  label: string;
  detail?: string;
  detailColor?: string;
  leading?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  trailing?: React.ReactNode;
  sub?: string;
}) {
  const type = useType();
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.fill }]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={type.rowTitle}>
          {label}
        </Text>
        {sub ? (
          <Text numberOfLines={2} style={type.meta}>
            {sub}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text numberOfLines={1} style={[s.detail, { color: detailColor ?? t.fgSubtle }]}>
          {detail}
        </Text>
      ) : null}
      {trailing}
      {chevron && onPress ? <Icon name="ChevronRight" size={16} color={t.fgSubtle} /> : null}
    </Pressable>
  );
}

/** A group's label in a list: a colored dot, the name and how many. */
export function GroupLabel({ label, color, inset = 20 }: { label: string; color?: string; inset?: number }) {
  const type = useType();
  const s = useStyles();
  return (
    <View style={[s.groupLabel, { paddingHorizontal: inset }]}>
      {color ? <View style={[s.groupDot, { backgroundColor: color }]} /> : null}
      <Text style={type.meta}>{label}</Text>
    </View>
  );
}

/** The floating "new" action at the bottom right of a tab. */
export function Fab({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.fab, pressed && { opacity: 0.9 }]}
    >
      <Icon name={icon} size={18} color={t.accentFg} />
      <Text style={s.fabText}>{label}</Text>
    </Pressable>
  );
}

/** A sheet from the bottom over a dimmed screen; a tap outside closes it. */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.sheetRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={tr("close")} />
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 18 }]}>
          <View style={s.handle} />
          {title ? <Text style={s.sheetTitle}>{title}</Text> : null}
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.bg },
  pageTitle: { flexDirection: "row", alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  subHeader: { height: 56, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4 },
  group: {
    borderRadius: t.radiusLg,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: t.border },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  detail: { fontSize: 13, maxWidth: "45%" },
  groupLabel: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, paddingBottom: 6 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    height: 56,
    paddingLeft: 16,
    paddingRight: 20,
    borderRadius: 18,
    backgroundColor: t.accent,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
  },
  fabText: { color: t.accentFg, fontSize: 14, fontWeight: "500" },
  sheetRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.45)" },
  sheet: {
    paddingTop: 10,
    paddingHorizontal: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: t.surfaceRaised,
    gap: 2,
    maxHeight: "85%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.fillStrong,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetTitle: { color: t.fg, fontSize: 16, fontWeight: "600", paddingHorizontal: 12, paddingBottom: 8 },
}));
