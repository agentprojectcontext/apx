import { useState } from "react";
import { Bell, BellOff, Monitor, Moon, Send, Sun, X } from "lucide-react";
import { Button, Dialog } from "../ui";
import { cn } from "../../lib/cn";
import { useTheme } from "../../hooks/useTheme";
import { t, setLocale, getLocale, LOCALES, type Locale } from "../../i18n";
import {
  disableNotifications,
  enableNotifications,
  notifyStance,
  sendTestNotification,
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

  // "On" is a claim until something actually appears. Between the browser's
  // permission, the OS letting the browser post at all, and a service worker
  // that has to be registered, there are three places this dies silently — and
  // the switch reads exactly the same in all of them.
  const [tested, setTested] = useState<null | boolean>(null);
  const test = async () => {
    setTested(null);
    setTested(await sendTestNotification());
  };

  return (
    <div className={className ?? "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={on ? "primary" : "secondary"} onClick={toggle} aria-pressed={on}>
          {on ? <Bell size={14} /> : <BellOff size={14} />} {on ? t("notify.on") : t("notify.off")}
        </Button>
        {on && (
          <Button variant="secondary" onClick={test}>
            <Send size={14} /> {t("notify.test")}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-fg">
        {tested === false ? t("notify.test_failed") : on ? t("notify.on_hint") : t("notify.off_hint")}
      </p>
    </div>
  );
}

/**
 * The offer, where you already are.
 *
 * It cannot be a prompt that opens by itself: browsers only accept
 * `Notification.requestPermission()` from a real click, and Chrome drops the
 * request outright when it is not tied to a gesture. So the app asks, and the
 * browser's own dialog comes after the tap. Shown once — a banner that returns
 * every session is an advert — and only while the browser has not decided yet.
 */
const NUDGE_DISMISSED = "apx.notify.nudge.dismissed";

export function NotifyNudge({ className, floating }: { className?: string; floating?: boolean }) {
  const [stance, setStance] = useState<NotifyStance>(() => notifyStance());
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  // Only the undecided case. Denied is not something a banner can fix, and off
  // is a decision that was already made here.
  if (hidden || stance.kind !== "ask") return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(NUDGE_DISMISSED, "1");
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 text-sm",
        // A strip at the top of the list on the phone, a card in the corner on
        // a desktop — the same offer, put where the eye already is.
        floating
          ? "fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
          : "shrink-0 border-b border-border bg-primary/5 px-4 py-3",
        className,
      )}
    >
      <Bell size={16} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{t("notify.nudge")}</span>
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          const next = await enableNotifications();
          setStance(next);
          if (next.kind === "on") dismiss();
        }}
      >
        {t("notify.nudge_yes")}
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
      >
        <X size={14} />
      </button>
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
