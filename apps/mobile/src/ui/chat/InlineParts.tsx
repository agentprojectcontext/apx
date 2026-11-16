import { createContext, useContext, useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import type { MediaItem } from "../../chat/media";
import { initials } from "../../format";
import { t } from "../../i18n";
import { type InlineNode, isMediaId } from "../../protocol";
import { Icon } from "../Icon";
import { Button } from "../kit";
import { useMediaUri } from "../media/context";
import { makeStyles, type Theme, type Tone, useTheme } from "../theme";

export type Of<K extends InlineNode["kind"]> = Extract<InlineNode, { kind: K }>;
export type CardTone = Of<"status">["tone"];

/** Writes to the chat as the owner; absent where nothing can be sent (a preview), and then no button asks. */
export const InlineAsk = createContext<((text: string) => Promise<unknown>) | undefined>(undefined);

/** The bordered box every card view draws in (a card, a map, a list of places, a table, an option). Follows the kit's
 * cards (packages/surfaces/src/kit/apx-kit-cards.css), the one source the panel and widgets use. */
export const inlineBox = (theme: Theme) =>
  ({
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface,
    overflow: "hidden",
  }) as const;

/** APX Kit's accent: a thin brand-to-violet line along a card's top edge, as wide as the card. */
export function Accent() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        opacity: 0.85,
        experimental_backgroundImage: `linear-gradient(90deg, ${theme.brand}, ${theme.violet})`,
      }}
    />
  );
}

/** The app has no green "success" family: brand is its green. */
export const toneOf = (tone: CardTone): Tone => (tone === "success" ? "brand" : tone);

/** A template with its `{name}` slots filled; unknown slots stay as written. */
export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/**
 * A button that writes `text` to the chat. Once that text is sent it shows so, and stays off until the text changes
 * (another option picked), so the same words never go twice.
 */
export function SendButton({
  label,
  text,
  primary = true,
  disabled,
}: {
  label: string;
  text: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const ask = useContext(InlineAsk);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>();
  if (!ask) return null;
  const done = sent === text;
  const press = async () => {
    setBusy(true);
    try {
      await ask(text);
      setSent(text);
    } catch {
      // The chat shows why it was not sent; the button can be pressed again.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      label={label}
      accessibilityLabel={done ? `${label}, ${t("inlineSent")}` : label}
      size="sm"
      variant={primary ? "primary" : "secondary"}
      busy={busy}
      disabled={disabled || done}
      {...(done ? { icon: "Check" as const } : {})}
      onPress={() => void press()}
    />
  );
}

export function Rating({ value }: { value: string }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.rating}>
      <Icon name="Star" size={13} color={theme.warning} />
      <Text style={s.ratingText}>{value}</Text>
    </View>
  );
}

/** − n + between `min` and `max`. */
export function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const step = (by: number, icon: "Minus" | "Plus", label: string, off: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={6}
      onPress={() => onChange(value + by)}
      style={({ pressed }) => [s.stepButton, pressed && { backgroundColor: theme.fill }]}
    >
      <Icon name={icon} size={14} color={off ? theme.subtle : theme.fg} />
    </Pressable>
  );
  return (
    <View style={s.stepper}>
      {step(-1, "Minus", t("inlineFewer"), value <= min)}
      <Text style={s.stepValue}>{value}</Text>
      {step(1, "Plus", t("inlineMore"), value >= max)}
    </View>
  );
}

/** An option's small picture, or its initials when it has none. */
export function Tile({ src, title }: { src?: string; title: string }) {
  const s = useStyles();
  if (!src) {
    return (
      <View style={s.tile}>
        <Text style={s.tileText}>{initials(title)}</Text>
      </View>
    );
  }
  return isMediaId(src) ? <HeldTile src={src} title={title} /> : <TileImage uri={src} title={title} />;
}

function HeldTile({ src, title }: { src: string; title: string }) {
  const item = useMemo<MediaItem>(
    () => ({ key: src, kind: "image", media_id: src, mime: "image/jpeg", name: title }),
    [src, title],
  );
  return <TileImage uri={useMediaUri(item).uri} title={title} />;
}

function TileImage({ uri, title }: { uri?: string; title: string }) {
  const s = useStyles();
  return (
    <View style={s.tile}>
      {uri && <Image source={{ uri }} style={s.tileImage} accessibilityLabel={title} resizeMode="cover" />}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { color: theme.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
  },
  stepButton: { width: 32, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  stepValue: { minWidth: 28, textAlign: "center", color: theme.fg, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tile: {
    width: 44,
    height: 44,
    borderRadius: theme.radiusSm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.fill,
  },
  tileText: { color: theme.muted, fontSize: 14, fontWeight: "600" },
  tileImage: { width: "100%", height: "100%" },
}));
