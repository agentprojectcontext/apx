import { Section } from "../Section";
import { LanguageButtons, ThemeButtons } from "./PanelPrefs";
import { t } from "../../i18n";

// Settings for the web panel itself: visual appearance (theme) + UI language.
// This is panel-local UX, distinct from the agent's identity. The controls
// themselves live in PanelPrefs — the phone offers the same two choices from
// its own inbox, and one of them drifting from the other is how you end up
// with a panel that is dark in one place and light in the next.
export function WebPanel() {
  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <Section title={t("settings.appearance")}>
        <ThemeButtons />
      </Section>

      <Section title={t("settings.language")}>
        <LanguageButtons />
      </Section>
    </div>
  );
}
