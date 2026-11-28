import { FOLDER_MOVED } from "../apc/folder-notice.ts";
import type { StoreSize } from "../db/db.ts";
import type { Store } from "../domain/store.ts";
import { NOISY_COMMENTS } from "../domain/tasks.ts";
import { computerHost } from "../environments/host.ts";
import { hasManagedSession } from "../extensions/sessions.ts";
import { CATALOG } from "../integrations/catalog.ts";
import type { NewsFacts } from "./entries.ts";

/** Names of private MCP connections, without their configuration. */
const ownMcpServers = (store: Store): string[] => {
  try {
    const servers = JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: object };
    return Object.keys(servers.mcpServers ?? {});
  } catch {
    return [];
  }
};
const connectedIntegrations = (store: Store): number => {
  const names = ownMcpServers(store);
  return CATALOG.filter((e) => names.includes(e.id)).length;
};

const signedIn = (store: Store, id: string) => Boolean(store.settings.get(`google_account:${id}`));

/** A store this big that cannot give space back is worth one compaction. */
const BIG_STORE_BYTES = 500 * 1024 * 1024;

export const newsFacts = (store: Store, o: { hermes?: boolean; storeSize?: StoreSize } = {}): NewsFacts => ({
  hermes: o.hermes ?? false,
  bigStore: o.storeSize !== undefined && !o.storeSize.incremental && o.storeSize.bytes >= BIG_STORE_BYTES,
  artifacts: store.surfaces.list().length,
  desktop: store.devices.list().some((d) => d.platform === "desktop"),
  devices: store.devices.list().length,
  phone: store.devices.list().some((d) => d.platform === "android" || d.platform === "ios"),
  androidPhone: store.devices.list().some((d) => d.platform === "android"),
  codex: store.threads.list({ engine: "codex", limit: 1 }).length > 0,
  claude: store.threads.list({ engine: "claude", limit: 1 }).length > 0,
  google: {
    calendar: signedIn(store, "google-calendar"),
    gmail: signedIn(store, "gmail"),
    drive: signedIn(store, "google-drive"),
    gmailReadable: signedIn(store, "gmail") && store.settings.get("google_client:gmail") === "own",
  },
  secretary: store.settings.read("profile").id === "secretary",
  contacts: store.persons.list().some((p) => p.role !== "owner" && p.role !== "blocked" && p.addresses.length > 0),
  channels: store.settings.read("channels").length,
  rooms: store.settings.read("channels").some((c) => (c.rooms?.rooms.length ?? 0) > 0),
  eventReminders: signedIn(store, "google-calendar") && store.settings.read("calendar_reminders").enabled,
  email: store.settings.read("channels").some((c) => c.type === "email" && c.email !== undefined),
  whatsapp: store.settings.read("channels").some((c) => c.type === "whatsapp"),
  integrations: connectedIntegrations(store),
  mcp: ownMcpServers(store).length,
  extensionEvents: store.extensions.list().some((e) => Boolean(e.manifest.events?.length)),
  extensionSessions: store.extensions.list().some((e) => hasManagedSession(e.manifest)),
  computer: computerHost() !== undefined && store.projects.list().length > 0,
  mac: process.platform === "darwin" && store.projects.list().length > 0,
  tasks: store.tasks.list({ state: "open", limit: 500 }).filter((t) => t.assignee).length,
  noisyTasks: store.tasks.noisy(NOISY_COMMENTS).length,
  localModels: store.settings.read("local_models_seen").length > 0,
  ownModels: store.agents.list().filter((a) => a.model_choice?.model).length,
  projects: store.projects.list().length,
  agentFolder: Boolean(store.settings.get(FOLDER_MOVED)),
  routines: store.routines.list().filter((r) => r.action === "agent" || r.action === "watch").length,
  promptedAgents: store.agents.list().filter((a) => a.kind !== "secretary" && a.prompt.trim()).length,
  agents: store.agents.list().filter((a) => a.kind !== "secretary").length,
  research: store.settings.read("discovery").enabled,
});
