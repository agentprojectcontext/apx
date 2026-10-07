import { Platform } from "react-native";
import { tokens } from "./tokens";

/** The panel's minimal dark tokens (generated from packages/ui), under the short names the app's styles use. */
export const theme = {
  ...tokens,
  muted: tokens.fgMuted,
  subtle: tokens.fgSubtle,
  raised: tokens.surfaceRaised,
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
} as const;

export type Tone = "neutral" | "brand" | "violet" | "info" | "warning" | "danger";

/** A tone's soft background and its text color, as the panel's tags and tinted tiles use them. */
export const toneColors: Record<Tone, { bg: string; fg: string; solid: string }> = {
  neutral: { bg: tokens.fill, fg: tokens.fgMuted, solid: tokens.fgSubtle },
  brand: { bg: tokens.brandSoft, fg: tokens.brandSoftFg, solid: tokens.brand },
  violet: { bg: tokens.violetSoft, fg: tokens.violetSoftFg, solid: tokens.violet },
  info: { bg: tokens.infoSoft, fg: tokens.infoSoftFg, solid: tokens.info },
  warning: { bg: tokens.warningSoft, fg: tokens.warningSoftFg, solid: tokens.warning },
  danger: { bg: tokens.dangerSoft, fg: tokens.dangerSoftFg, solid: tokens.danger },
};
