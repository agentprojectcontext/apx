import { projectTeam } from "../domain/agent-directory.ts";
import type { Store } from "../domain/store.ts";
import { mcpConfig } from "../mcp/config.ts";
import { changedMigrationBindings, type MigrationBindings } from "./bindings.ts";

export function migrationEnvironment(
  store: Store,
  source: string,
  destination: string,
  bindings?: (project: string) => MigrationBindings,
) {
  const resources = mcpConfig(store)
    .project(source)
    .map((d) => ({ name: d.name, hash: d.hash }));
  const destinationAgents = (projectTeam(store, destination) ?? []).map((a) => ({ id: a.id, name: a.name }));
  const sourceBindings = bindings?.(source) ?? [];
  const destinationBindings = bindings?.(destination) ?? [];
  const bindingChanges = changedMigrationBindings(sourceBindings, destinationBindings);
  const connectionsLeft = [
    ...new Set([
      ...resources.map((d) => d.name),
      ...sourceBindings
        .filter(
          (before) => before.active && !destinationBindings.some((after) => after.active && after.id === before.id),
        )
        .map((d) => d.name),
    ]),
  ];
  return { resources, destinationAgents, sourceBindings, destinationBindings, bindingChanges, connectionsLeft };
}
