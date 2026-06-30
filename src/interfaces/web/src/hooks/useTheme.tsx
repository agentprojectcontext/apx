// Theme controller. The CSS in styles.css already supports both modes via
// the `.dark` class on <html>. State lives in ThemeProvider so every
// useTheme() consumer (Logo, TopBar, Settings) stays in sync.
//
// `preference` is what the user picked (light | dark | system); `theme` is the
// *resolved* mode actually applied (light | dark). System tracks the OS via
// matchMedia and re-applies live when the OS scheme flips.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { STORAGE } from "../constants";

type Resolved = "light" | "dark";
type Preference = "light" | "dark" | "system";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: Preference): Resolved {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function readPreference(): Preference {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(STORAGE.theme);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "dark";
}

type ThemeContextValue = {
  /** Resolved mode actually applied — "light" | "dark". */
  theme: Resolved;
  /** User selection — "light" | "dark" | "system". */
  preference: Preference;
  toggle: () => void;
  set: (p: Preference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(readPreference);
  const [theme, setTheme] = useState<Resolved>(() => resolve(readPreference()));

  useEffect(() => {
    const apply = () => {
      const r = resolve(preference);
      setTheme(r);
      document.documentElement.classList.toggle("dark", r === "dark");
    };
    apply();
    try { localStorage.setItem(STORAGE.theme, preference); } catch { /* ignore quota */ }

    // While on "system", follow the OS scheme live.
    if (preference === "system" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [preference]);

  // Quick toggle (TopBar): flip the *visible* mode to its opposite.
  const toggle = useCallback(() => {
    setPreference((p) => (resolve(p) === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, toggle, set: setPreference }),
    [theme, preference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
