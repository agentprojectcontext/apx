import type { ConfigSection } from "./ConfigTabsEditor";
import { PERMISSION_MODES } from "../../constants";
import { t } from "../../i18n";
import { projectKindOptions } from "./projectKinds";

// These are functions (not module-level consts) so t() runs per-render with the
// active locale — a frozen const would lock the strings to the locale at import.
//
// One tab, two files. What a project IS (name, type) lives in the committed
// `.apc/project.json`; how it BEHAVES (permissions, standing instructions) lives
// in its machine-local config. Which file a field lands in is a detail of the
// save, not a reason to make someone hunt through two tabs for it — the split
// was an implementation leaking into the UI.
//
// `apcProjectFields` is the subset that goes to .apc/project.json; everything in
// `projectBehaviourFields` goes to the config. Telegram is edited on its own
// channel page (the canonical mechanism) and models on the Models tab.

export function apcProjectFields(): ConfigSection {
  return {
    key: "identity",
    label: t("settings_ui.cfg_project_label"),
    description: t("settings_ui.cfg_project_desc"),
    fields: [
      { path: "name", label: t("settings_ui.cfg_name") },
      // The type is metadata like the rest, and it belongs here rather than
      // only in the Add-project dialog: a project you typed wrong should not
      // have to be unregistered and re-added to be retyped.
      {
        path: "kind",
        label: t("add_project.kind_label"),
        kind: "select",
        options: projectKindOptions(),
        hint: t("settings_ui.cfg_kind_hint"),
      },
      { path: "version", label: t("settings_ui.cfg_version") },
      { path: "apf", label: t("settings_ui.cfg_apc_spec") },
      { path: "apx", label: t("settings_ui.cfg_apx_install") },
      { path: "apx_id", label: t("settings_ui.cfg_apx_storage_id") },
    ],
  };
}

export function projectBehaviourFields(): ConfigSection {
  return {
    key: "behaviour",
    label: t("settings_ui.cfg_behaviour_label"),
    description: t("settings_ui.cfg_behaviour_desc"),
    fields: [
      {
        path: "super_agent.permission_mode",
        label: t("settings_ui.cfg_permission_mode"),
        kind: "select",
        options: PERMISSION_MODES.map((mode) => ({ value: mode, label: mode })),
        hint: t("settings_ui.cfg_permission_hint"),
      },
      // `super_agent.instructions`, NOT `super_agent.system`. This field was
      // labelled "extra prompt" and wired to `system`, which REPLACES the whole
      // base role prompt (prompt-builder.js) — so anyone who typed a note here
      // silently deleted the agent's entire briefing. `instructions` is the
      // additive one, which is what the label always promised.
      {
        path: "super_agent.instructions",
        label: t("settings_ui.cfg_instructions"),
        kind: "textarea",
        hint: t("settings_ui.cfg_instructions_hint"),
      },
    ],
  };
}

// Kept for the base project (id 0), which has no .apc/project.json to edit.
export function apcProjectSections(): ConfigSection[] {
  return [apcProjectFields()];
}
