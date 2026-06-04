import type { ConfigSection } from "./ConfigTabsEditor";
import { PERMISSION_MODES } from "../../constants";

export const GLOBAL_CONFIG_SECTIONS: ConfigSection[] = [
  {
    key: "daemon",
    label: "Daemon",
    description: "~/.apx/config.json. Config general APX.",
    fields: [
      { path: "port", label: "Port", kind: "number", placeholder: "7430" },
      { path: "host", label: "Host", placeholder: "127.0.0.1" },
      { path: "log_level", label: "Log level", placeholder: "info" },
      { path: "user.language", label: "Idioma", placeholder: "es" },
      { path: "user.locale", label: "Locale", placeholder: "es-AR" },
      { path: "user.timezone", label: "Timezone", placeholder: "America/Argentina/Salta" },
    ],
  },
  {
    key: "super-agent",
    label: "Super-agente",
    fields: [
      { path: "super_agent.enabled", label: "Super-agente habilitado", kind: "boolean" },
      { path: "super_agent.model", label: "Modelo", placeholder: "gemini:gemini-2.5-flash" },
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
      { path: "telegram.enabled", label: "Polling habilitado", kind: "boolean" },
      { path: "telegram.poll_interval_ms", label: "Poll interval ms", kind: "number", placeholder: "1500" },
      { path: "telegram.respond_with_engine", label: "Responder con engine", kind: "boolean" },
      { path: "telegram.route_to_agent", label: "Route to agent", placeholder: "master" },
      { path: "telegram.channels.0.chat_id", label: "Default chat ID" },
      { path: "telegram.channels.0.bot_token", label: "Default bot token", kind: "password" },
    ],
  },
  {
    key: "engines",
    label: "Engines",
    fields: [
      { path: "engines.anthropic.api_key", label: "Anthropic API key", kind: "password" },
      { path: "engines.openai.api_key", label: "OpenAI API key", kind: "password" },
      { path: "engines.openai.base_url", label: "OpenAI base URL", placeholder: "https://api.openai.com/v1" },
      { path: "engines.groq.api_key", label: "Groq API key", kind: "password" },
      { path: "engines.groq.base_url", label: "Groq base URL", placeholder: "https://api.groq.com/openai/v1" },
      { path: "engines.openrouter.api_key", label: "OpenRouter API key", kind: "password" },
      { path: "engines.openrouter.base_url", label: "OpenRouter base URL", placeholder: "https://openrouter.ai/api/v1" },
      { path: "engines.gemini.api_key", label: "Gemini API key", kind: "password" },
      { path: "engines.ollama.base_url", label: "Ollama URL", placeholder: "http://localhost:11434" },
    ],
  },
];
