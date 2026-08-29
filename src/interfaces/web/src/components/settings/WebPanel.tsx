import { Section } from "../Section";
import { LanguageButtons, NotificationChannels, NotificationSwitch, ThemeButtons } from "./PanelPrefs";
import { t } from "../../i18n";

// Settings for the web panel itself: appearance, UI language, notifications.
// This is panel-local UX, distinct from the agent's identity. The controls
// themselves live in PanelPrefs — the phone offers the same choices from its
// own inbox, and one of them drifting from the other is how you end up with a
// panel that is dark in one place and light in the next.
//
// Notifications shipped in the phone's dialog only, which is the one surface
// the person at a desk never opens: there was a switch, and no way to reach it
// from the panel where they actually sit. A permission you cannot grant is the
// same as not having built it.
export function WebPanel() {
  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <Section title={t("settings.appearance")}>
        <ThemeButtons />
      </Section>

      <Section title={t("settings.language")}>
        <LanguageButtons />
      </Section>

      <Section title={t("notify.title")}>
        <div className="space-y-4">
          <NotificationSwitch />
          {/* Which channels may ring THIS device — the laptop and the phone
              answer that differently, so the answer is stored per device. */}
          <NotificationChannels />
        </div>
      </Section>
    </div>
  );
}
