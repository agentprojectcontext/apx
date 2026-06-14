import type { ConfigSection } from "./ConfigTabsEditor";
import { PERMISSION_MODES } from "../../constants";
import { t } from "../../i18n";

// These are functions (not module-level consts) so t() runs per-render with the
// active locale — a frozen const would lock the strings to the locale at import.
export function projectOverrideSections(): ConfigSection[] {
  return [
    {
      key: "routing",
      label: t("settings_ui.cfg_overrides_label"),
      description: t("settings_ui.cfg_overrides_desc"),
      fields: [
        { path: "route_to_agent", label: t("settings_ui.cfg_route_to_agent"), placeholder: "master" },
        { path: "super_agent.model", label: t("settings_ui.cfg_super_agent_model") },
        {
          path: "super_agent.permission_mode",
          label: t("settings_ui.cfg_permission_mode"),
          kind: "select",
          options: PERMISSION_MODES.map((mode) => ({ value: mode, label: mode })),
        },
        { path: "super_agent.system", label: t("settings_ui.cfg_extra_prompt"), kind: "textarea" },
      ],
    },
    {
      key: "telegram",
      label: t("settings_ui.cfg_telegram_label"),
      fields: [
        { path: "telegram.route_to_agent", label: t("settings_ui.cfg_route_to_agent") },
        { path: "telegram.chat_id", label: t("settings_ui.cfg_chat_id") },
        { path: "telegram.bot_token", label: t("settings_ui.cfg_bot_token"), kind: "password" },
        { path: "telegram.respond_with_engine", label: t("settings_ui.cfg_respond_with_engine"), kind: "boolean" },
      ],
    },
    {
      key: "engines",
      label: t("settings_ui.cfg_engines_label"),
      fields: [
        { path: "engines.ollama.base_url", label: t("settings_ui.cfg_ollama_url") },
        { path: "engines.anthropic.api_key", label: t("settings_ui.cfg_anthropic_key"), kind: "password" },
        { path: "engines.openai.api_key", label: t("settings_ui.cfg_openai_key"), kind: "password" },
        { path: "engines.groq.api_key", label: t("settings_ui.cfg_groq_key"), kind: "password" },
        { path: "engines.openrouter.api_key", label: t("settings_ui.cfg_openrouter_key"), kind: "password" },
        { path: "engines.gemini.api_key", label: t("settings_ui.cfg_gemini_key"), kind: "password" },
      ],
    },
  ];
}

export function apcProjectSections(): ConfigSection[] {
  return [
    {
      key: "identity",
      label: t("settings_ui.cfg_project_label"),
      description: t("settings_ui.cfg_project_desc"),
      fields: [
        { path: "name", label: t("settings_ui.cfg_name") },
        { path: "version", label: t("settings_ui.cfg_version") },
        { path: "apf", label: t("settings_ui.cfg_apc_spec") },
        { path: "apx", label: t("settings_ui.cfg_apx_install") },
        { path: "apx_id", label: t("settings_ui.cfg_apx_storage_id") },
      ],
    },
  ];
}
