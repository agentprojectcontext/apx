import type { ConfigSection } from "./ConfigTabsEditor";
import { PERMISSION_MODES } from "../../constants";

export const PROJECT_OVERRIDE_SECTIONS: ConfigSection[] = [
  {
    key: "routing",
    label: "Overrides",
    description: ".apc/config.json. Sólo valores propios del proyecto; vacío hereda global/effective.",
    fields: [
      { path: "route_to_agent", label: "Route to agent", placeholder: "master" },
      { path: "super_agent.model", label: "Super-agent model" },
      {
        path: "super_agent.permission_mode",
        label: "Permission mode",
        kind: "select",
        options: PERMISSION_MODES.map((mode) => ({ value: mode, label: mode })),
      },
      { path: "super_agent.system", label: "Prompt extra", kind: "textarea" },
    ],
  },
  {
    key: "telegram",
    label: "Telegram",
    fields: [
      { path: "telegram.route_to_agent", label: "Route to agent" },
      { path: "telegram.chat_id", label: "Chat ID" },
      { path: "telegram.bot_token", label: "Bot token", kind: "password" },
      { path: "telegram.respond_with_engine", label: "Responder con engine", kind: "boolean" },
    ],
  },
  {
    key: "engines",
    label: "Engines",
    fields: [
      { path: "engines.ollama.base_url", label: "Ollama URL" },
      { path: "engines.anthropic.api_key", label: "Anthropic API key", kind: "password" },
      { path: "engines.openai.api_key", label: "OpenAI API key", kind: "password" },
      { path: "engines.groq.api_key", label: "Groq API key", kind: "password" },
      { path: "engines.openrouter.api_key", label: "OpenRouter API key", kind: "password" },
      { path: "engines.gemini.api_key", label: "Gemini API key", kind: "password" },
    ],
  },
];

export const APC_PROJECT_SECTIONS: ConfigSection[] = [
  {
    key: "identity",
    label: "Proyecto",
    description: ".apc/project.json. Metadata APC portable; no secrets, no runtime.",
    fields: [
      { path: "name", label: "Name" },
      { path: "version", label: "Version" },
      { path: "apf", label: "APC spec" },
      { path: "apx", label: "APX install state" },
      { path: "apx_id", label: "APX storage id" },
    ],
  },
];
