// The resources strings other screens use too: they load with the first screen; the rest is the "resources" pack.
import type { MessageKey } from "./en.ts";

export const esResourcesShared: Partial<Record<MessageKey, string>> = {
  "res.mcpOpen": "Editar conexión",
  "res.error": "Recursos: {error}",
  "res.tab.skills": "Skills",
  "res.tab.mcp": "MCP",
  "res.tab.integrations": "Integraciones",
  "res.tab.variables": "Variables",
  "res.tab.extensions": "Extensiones",
};
