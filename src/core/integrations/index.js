// Public surface of the integrations core module. Daemon + agent tools import
// from here.
export {
  integrationsPath,
  defaultIntegrationsStorage,
  readIntegrations,
  writeIntegrations,
} from "./sources.js";
export { IntegrationStore, resolveIntegration, redactRecord } from "./store.js";
export { listCatalog, getPluginService, PLUGIN_SERVICES } from "./catalog.js";
export { reconcilePluginMcp } from "./mcp-sync.js";
export { collectMemorySources, syncMemoryToVault } from "./obsidian-memory.js";
