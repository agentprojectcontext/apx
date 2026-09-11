import { t } from "../../i18n";

/**
 * The five things a project can be, in the order they are usually the answer.
 *
 * A function, not a const: t() is read at call time and a language switch would
 * otherwise leave these strings in the old one. `other` is last because it is
 * what you pick when none of the others fit, not a first option.
 *
 * One list, two places — the Add-project dialog and a registered project's own
 * config — because a project that can only be typed at creation forces you to
 * unregister and re-add it just to change your mind.
 */
export function projectKindOptions() {
  return [
    { value: "personal", label: t("settings_ui.kind_personal"), description: t("add_project.kind_personal_desc") },
    { value: "app", label: t("settings_ui.kind_app"), description: t("add_project.kind_app_desc") },
    { value: "company", label: t("settings_ui.kind_company"), description: t("add_project.kind_company_desc") },
    { value: "software", label: t("settings_ui.kind_software"), description: t("add_project.kind_software_desc") },
    { value: "other", label: t("settings_ui.kind_other"), description: t("add_project.kind_other_desc") },
  ];
}
