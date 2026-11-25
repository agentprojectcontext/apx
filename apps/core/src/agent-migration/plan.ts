import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AGENT_DIR } from "../apc/folder.ts";
import { withoutAgentParent } from "../apc/move-agent-text.ts";
import { readAgents } from "../apc/read.ts";
import {
  inventoryMigrationFiles,
  type MigrationFile,
  migrationFilePath,
  readMigrationFile,
} from "../domain/agent-migration-files.ts";
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import { mcpConfig } from "../mcp/config.ts";
import { realpath } from "../paths.ts";
import type { MigrationBindings } from "./bindings.ts";
import { migrationEnvironment } from "./environment.ts";

type Change = { root: "source" | "destination"; relative: string; after: Uint8Array | null; mode?: number };
type FileGroup = {
  name: "work" | "artifacts" | "artifact-sources";
  source: string;
  destination: string;
  changes: Change[];
};
export type MoveInput = { agent: string; destination: string; paths: string[] };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function buildMigrationPlan(
  store: Store,
  home: string,
  input: MoveInput,
  bindings?: (project: string) => MigrationBindings,
) {
  const inventory = store.agentMigration.inventory(input.agent, input.destination);
  const agent = store.agents.get(input.agent);
  const sourceProject = store.projects.get(inventory.source);
  const destinationProject = store.projects.get(inventory.destination);
  if (!agent?.slug || !sourceProject?.path || !destinationProject?.path)
    throw badRequest("Both project folders must be available");
  const work = inventoryMigrationFiles(sourceProject.path, destinationProject.path, input.paths);
  const groups: FileGroup[] = [{ name: "work", source: work.source, destination: work.destination, changes: [] }];
  const files: Array<MigrationFile & { kind: FileGroup["name"] }> = work.files.map((f) => ({ ...f, kind: "work" }));
  for (const f of work.files) {
    groups[0]?.changes.push(
      { root: "source", relative: f.from, after: null },
      {
        root: "destination",
        relative: f.to,
        after: readMigrationFile(migrationFilePath(work.source, f.from)),
        mode: f.mode,
      },
    );
  }
  const definition = `.agent/agents/${agent.slug}.md`;
  const sourceFile = migrationFilePath(work.source, definition);
  const targetFile = migrationFilePath(work.destination, definition);
  if (fs.existsSync(targetFile))
    throw badRequest("An agent definition with this name already exists in the destination");
  const text = readMigrationFile(sourceFile, 1024 * 1024).toString("utf8");
  const parsed = readAgents(work.source).find((a) => a.slug === agent.slug);
  const prompt =
    parsed &&
    [parsed.description && !parsed.prompt.includes(parsed.description) ? parsed.description : "", parsed.prompt]
      .filter(Boolean)
      .join("\n\n");
  const blockers = [...inventory.blockers];
  if (prompt !== agent.prompt) blockers.push("definition_changed");
  const changes = groups[0]?.changes;
  changes?.push(
    { root: "source", relative: definition, after: null },
    {
      root: "destination",
      relative: definition,
      after: Buffer.from(withoutAgentParent(text)),
      mode: fs.statSync(sourceFile).mode & 0o777,
    },
  );
  const children = store.agents
    .list()
    .filter((a) => a.project_id === inventory.source && (a.parent === agent.id || a.parent === agent.slug));
  for (const child of children) {
    if (!child.slug) throw badRequest("A subordinate has no project definition");
    const relative = `.agent/agents/${child.slug}.md`;
    const before = readMigrationFile(migrationFilePath(work.source, relative), 1024 * 1024).toString("utf8");
    changes?.push({ root: "source", relative, after: Buffer.from(withoutAgentParent(before)) });
  }
  const artifactNames = inventory.surfaces.map((id) => store.surfaces.get(id)?.name).filter((n): n is string => !!n);
  for (const kind of ["artifacts", "artifact-sources"] as const) {
    const source = path.join(home, kind, inventory.source);
    const names = artifactNames.filter((name) => fs.existsSync(migrationFilePath(source, name)));
    if (!names.length) continue;
    const data = inventoryMigrationFiles(source, path.join(home, kind, inventory.destination), names);
    const group: FileGroup = { name: kind, source: data.source, destination: data.destination, changes: [] };
    for (const f of data.files) {
      group.changes.push(
        { root: "source", relative: f.from, after: null },
        {
          root: "destination",
          relative: f.to,
          after: readMigrationFile(migrationFilePath(data.source, f.from)),
          mode: f.mode,
        },
      );
      files.push({ ...f, kind });
    }
    groups.push(group);
  }
  const sourceSkills = path.join(work.source, AGENT_DIR, "skills");
  for (const name of agent.skills ?? []) {
    if (fs.existsSync(migrationFilePath(sourceSkills, name))) blockers.push("project_skill_requires_selection");
  }
  const published = JSON.parse(store.settings.get("public_artifact_sources") ?? "{}") as Record<string, string>;
  if (Object.values(published).some((id) => inventory.surfaces.includes(id))) blockers.push("published_surface");
  if (
    store.agentMigrationPending
      .list()
      .some((p) => [p.source, p.destination].some((id) => id === inventory.source || id === inventory.destination))
  )
    blockers.push("unfinished_migration");
  const resources = mcpConfig(store)
    .project(inventory.source)
    .map((d) => ({ name: d.name, hash: d.hash }));
  const fingerprints = groups.flatMap((group) =>
    group.changes.map((change) => ({
      group: group.name,
      root: change.root,
      relative: change.relative,
      before: fs.existsSync(migrationFilePath(group[change.root], change.relative))
        ? createHash("sha256")
            .update(readMigrationFile(migrationFilePath(group[change.root], change.relative)))
            .digest("hex")
        : null,
      after: change.after ? createHash("sha256").update(change.after).digest("hex") : null,
      mode: change.mode,
    })),
  );
  const { destinationAgents, sourceBindings, destinationBindings, bindingChanges, connectionsLeft } =
    migrationEnvironment(store, inventory.source, inventory.destination, bindings);
  const revision = hash({
    inventory: inventory.revision,
    files,
    fingerprints,
    resources,
    published,
    destinationAgents,
    sourceBindings,
    destinationBindings,
  });
  return {
    inventory,
    groups,
    input,
    preview: {
      ...inventory,
      revision,
      source_name: sourceProject.name,
      destination_name: destinationProject.name,
      paths: [...new Set(input.paths)].sort(),
      files,
      blockers: [...new Set(blockers)],
      detached_agents: children.map((a) => ({ id: a.id, name: a.name })),
      connections_left: connectionsLeft,
      binding_changes: bindingChanges,
      destination_agents: destinationAgents,
      source_root: realpath(work.source),
      destination_root: realpath(work.destination),
    },
  };
}
