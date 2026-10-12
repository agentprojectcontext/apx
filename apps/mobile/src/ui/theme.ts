import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from "react";
import { Appearance, AppState, Platform, StyleSheet } from "react-native";
import { palettes } from "./tokens";
import type { Tone } from "./tone";

export type { Tone };
export type Scheme = keyof typeof palettes;

type Palette = { [K in keyof typeof palettes.dark]: (typeof palettes.dark)[K] extends number ? number : string };

/** The panel's minimal tokens for one scheme (generated from packages/ui), under the short names the app's styles use. */
function build(scheme: Scheme) {
  const tokens: Palette = palettes[scheme];
  return {
    ...tokens,
    scheme,
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
    /** A tone's soft background and its text color, as the panel's tags and tinted tiles use them. */
    tones: {
      neutral: { bg: tokens.fill, fg: tokens.fgMuted, solid: tokens.fgSubtle },
      brand: { bg: tokens.brandSoft, fg: tokens.brandSoftFg, solid: tokens.brand },
      violet: { bg: tokens.violetSoft, fg: tokens.violetSoftFg, solid: tokens.violet },
      info: { bg: tokens.infoSoft, fg: tokens.infoSoftFg, solid: tokens.info },
      warning: { bg: tokens.warningSoft, fg: tokens.warningSoftFg, solid: tokens.warning },
      danger: { bg: tokens.dangerSoft, fg: tokens.dangerSoftFg, solid: tokens.danger },
    } satisfies Record<Tone, { bg: string; fg: string; solid: string }>,
  };
}

export type Theme = ReturnType<typeof build>;
export const themes: Record<Scheme, Theme> = { light: build("light"), dark: build("dark") };

const ThemeContext = createContext<Theme>(themes.dark);

/** Draws everything below it in one scheme. */
export function ThemeProvider({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  return createElement(ThemeContext.Provider, { value: themes[scheme] }, children);
}

export const useTheme = () => useContext(ThemeContext);

/** A hook giving the styles `create` builds for the current theme, built once per scheme. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(create: (t: Theme) => T): () => T {
  const built = new Map<Theme, T>();
  return () => {
    const theme = useTheme();
    let styles = built.get(theme);
    if (!styles) {
      styles = StyleSheet.create(create(theme));
      built.set(theme, styles);
    }
    return styles;
  };
}

const systemScheme = (): Scheme => (Appearance.getColorScheme() === "dark" ? "dark" : "light");

/** The scheme the phone asks for (or the one picked in Settings, set through Appearance.setColorScheme). */
export function useSystemScheme(): Scheme {
  const [scheme, setScheme] = useState(systemScheme);
  useEffect(() => {
    // iOS flips the scheme while it snapshots a backgrounded app: only an active app follows it.
    const appearance = Appearance.addChangeListener(() => {
      if (AppState.currentState === "active") setScheme(systemScheme());
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") setScheme(systemScheme());
    });
    return () => {
      appearance.remove();
      app.remove();
    };
  }, []);
  return scheme;
}

/** Until every screen reads the theme through useTheme: the dark one. */
export const theme = themes.dark;
export const toneColors = theme.tones;
