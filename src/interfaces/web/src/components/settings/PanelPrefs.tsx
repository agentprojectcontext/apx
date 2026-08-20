import { useState } from "react";
import { Bell, BellOff, Monitor, Moon, Sun } from "lucide-react";
import { Button, Dialog } from "../ui";
import { useTheme } from "../../hooks/useTheme";
import { t, setLocale, getLocale, LOCALES, type Locale } from "../../i18n";
import {
  disableNotifications,
  enableNotifications,
  notifyStance,
  type NotifyStance,
} from "../../lib/notify";

// The two panel-local preferences — how it looks, and what language it speaks.
// They live here rather than inside the settings screen because the phone
// surface needs them too: /mobile is chat and nothing else, so "switch to dark"
// used to mean leaving for the desktop panel and finding the Web module.

/** Light / dark / follow-the-OS, as three buttons with the mode's own glyph. */
export function ThemeButtons({ className }: { className?: string }) {
  const { preference, set } = useTheme();
  const modes = [
    { key: "light", icon: Sun, label: t("settings.light_mode") },
    { key: "dark", icon: Moon, label: t("settings.dark_mode") },
    { key: "system", icon: Monitor, label: t("settings.system_mode") },
  ] as const;
  return (
    <div className={className ?? "flex items-center gap-2"}>
      {modes.map((m) => (
        <Button
          key={m.key}
          variant={preference === m.key ? "primary" : "secondary"}
          onClick={() => set(m.key)}
          aria-pressed={preference === m.key}
        >
          <m.icon size={14} /> {m.label}
        </Button>
      ))}
    </div>
  );
}

/** One button per locale we ship. Picking one reloads: every string in the
 *  tree was resolved at render time, so a live swap would leave half the app
 *  in the language you just left. */
export function LanguageButtons({ className }: { className?: string }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const change = (l: Locale) => {
    setLocale(l);
    setLocaleState(l);
    window.location.reload();
  };
  return (
    <div className={className ?? "flex items-center gap-2"}>
      {LOCALES.map((lo) => (
        <Button
          key={lo.value}
          variant={locale === lo.value ? "primary" : "secondary"}
          onClick={() => change(lo.value)}
          aria-pressed={locale === lo.value}
        >
          {lo.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * One switch for "tell me when an agent writes".
 *
 * It is a button and not a checkbox because turning it ON is a browser
 * permission prompt, which can be refused — the state afterwards is the
 * browser's answer, not the click's. Everything the user cannot fix from here
 * (a blocked permission, an insecure origin) says so in place of the button
 * rather than offering one that would do nothing.
 */
export function NotificationSwitch({ className }: { className?: string }) {
  const [stance, setStance] = useState<NotifyStance>(() => notifyStance());

  if (stance.kind === "insecure") {
    return <p className={className ?? "text-xs text-muted-fg"}>{t("notify.insecure")}</p>;
  }
  if (stance.kind === "unsupported") {
    return <p className={className ?? "text-xs text-muted-fg"}>{t("notify.unsupported")}</p>;
  }
  if (stance.kind === "denied") {
    return <p className={className ?? "text-xs text-muted-fg"}>{t("notify.denied")}</p>;
  }

  const on = stance.kind === "on";
  const toggle = async () => {
    if (on) {
      disableNotifications();
      setStance(notifyStance());
      return;
    }
    setStance(await enableNotifications());
  };
  return (
    <div className={className ?? "space-y-2"}>
      <Button variant={on ? "primary" : "secondary"} onClick={toggle} aria-pressed={on}>
        {on ? <Bell size={14} /> : <BellOff size={14} />} {on ? t("notify.on") : t("notify.off")}
      </Button>
      <p className="text-xs text-muted-fg">{on ? t("notify.on_hint") : t("notify.off_hint")}</p>
    </div>
  );
}

/** Both of them in a sheet small enough to be a decision, not a screen. */
export function PrefsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title={t("mobile.prefs")} size="sm">
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
            {t("settings.appearance")}
          </h3>
          <ThemeButtons className="grid grid-cols-3 gap-2" />
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
            {t("settings.language")}
          </h3>
          <LanguageButtons className="grid grid-cols-2 gap-2" />
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
            {t("notify.title")}
          </h3>
          <NotificationSwitch />
        </section>
      </div>
    </Dialog>
  );
}
