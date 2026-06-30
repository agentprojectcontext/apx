import { useState } from "react";
import { Section } from "../Section";
import { Button } from "../ui";
import { useTheme } from "../../hooks/useTheme";
import { t, setLocale, getLocale, LOCALES, type Locale } from "../../i18n";

// Settings for the web panel itself: visual appearance (theme) + UI language.
// This is panel-local UX, distinct from the agent's identity.
export function WebPanel() {
  const { preference, set } = useTheme();
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const changeLocale = (l: Locale) => {
    setLocale(l);
    setLocaleState(l);
    // Reload so all rendered strings pick up the new locale.
    window.location.reload();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <Section title={t("settings.appearance")}>
        <div className="flex items-center gap-2">
          <Button variant={preference === "light"  ? "primary" : "secondary"} onClick={() => set("light")}>{t("settings.light_mode")}</Button>
          <Button variant={preference === "dark"   ? "primary" : "secondary"} onClick={() => set("dark")}>{t("settings.dark_mode")}</Button>
          <Button variant={preference === "system" ? "primary" : "secondary"} onClick={() => set("system")}>{t("settings.system_mode")}</Button>
        </div>
      </Section>

      <Section title={t("settings.language")}>
        <div className="flex items-center gap-2">
          {LOCALES.map((lo) => (
            <Button
              key={lo.value}
              variant={locale === lo.value ? "primary" : "secondary"}
              onClick={() => changeLocale(lo.value)}
            >
              {lo.label}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
