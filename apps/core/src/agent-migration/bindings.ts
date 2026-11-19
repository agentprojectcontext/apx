import { lineage } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import type { Mcp } from "../mcp/manager.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";

type Connections = Pick<Mcp, "references">;
export function migrationBindings(store: Store, mcp: Connections, secrets: Pick<Secrets, "has">, project: string) {
  const binding = (name: string, projects: string[]) => {
    const candidates = [...projects.map((id) => projectSecretName(id, name)), name];
    return candidates.find((candidate) => secrets.has(`secret://${candidate}`)) ?? null;
  };
  return mcp.references(project).map((connection) => ({
    id: connection.id,
    name: connection.name,
    hash: connection.hash,
    active: connection.active,
    variables: connection.variables.map((name) => ({
      name,
      transport: binding(name, connection.projects),
      arguments: binding(name, lineage(store.projects, project)),
    })),
  }));
}
export type MigrationBindings = ReturnType<typeof migrationBindings>;

export function changedMigrationBindings(source: MigrationBindings, destination: MigrationBindings) {
  return source.flatMap((before) => {
    const after = destination.find((connection) => connection.id === before.id && connection.active);
    if (!before.active || !after) return [];
    const changed = before.variables.filter((variable) => {
      const next = after.variables.find((v) => v.name === variable.name);
      return variable.transport !== next?.transport || variable.arguments !== next?.arguments;
    });
    return changed.length ? [{ connection: before.name, variables: changed.map((v) => v.name) }] : [];
  });
}
