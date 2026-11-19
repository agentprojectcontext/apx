import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentMigrationInventory, AgentMigrationPreview } from "./agent-migration.ts";
import { methods } from "./methods.ts";

const id = "2bd15883-b63d-4e7c-9fd0-d80fb5736f0e";
const inventory = {
  agent: "acme",
  source: "p_acme",
  destination: "p_northwind",
  revision: "r",
  tasks: [],
  detached_tasks: [],
  threads: [],
  detached_threads: [],
  memories: [],
  routines: [],
  surfaces: [],
  media: [],
  source_attachment_copies: [],
  flow_bindings: [],
  permissions_reset: 0,
  shared_tasks: [],
  shared_threads: [],
  blockers: [],
};
test("migration methods are owner-scoped and only apply/recover have effects", () => {
  for (const name of ["agents.migration_preview", "agents.migrate", "agents.migration_recover"] as const)
    assert.equal(methods[name].access, "human");
  assert.equal(methods["agents.migration_preview"].effect, false);
  assert.equal(methods["agents.migrate"].effect, true);
  assert.equal(methods["agents.migration_recover"].effect, true);
  assert.deepEqual(
    methods["agents.migration_preview"].params.parse({ agent: "acme", destination: "p_northwind" }).paths,
    [],
  );
  assert.equal(
    methods["agents.migrate"].params.safeParse({ agent: "acme", destination: "p_northwind" }).success,
    false,
  );
  assert.equal(methods["agents.migration_recover"].params.safeParse({ id: "invalid" }).success, false);
});

test("preview and receipts validate a complete typed inventory and reject extra data", () => {
  const preview = {
    ...inventory,
    id,
    source_name: "Acme",
    destination_name: "Northwind",
    paths: ["reports"],
    files: [{ from: "reports/a.csv", to: "reports/a.csv", digest: "digest", bytes: 3, mode: 384, kind: "work" }],
    detached_agents: [{ id: "acme-helper", name: "Acme helper" }],
    connections_left: [],
    binding_changes: [],
    destination_agents: [],
    source_root: "~/work/acme",
    destination_root: "~/work/northwind",
  };
  assert.equal(AgentMigrationPreview.safeParse(preview).success, true);
  assert.equal(AgentMigrationInventory.safeParse({ ...inventory, private_data: "unexpected" }).success, false);
  assert.equal(
    AgentMigrationPreview.safeParse({ ...preview, files: [{ ...preview.files[0], bytes: -1 }] }).success,
    false,
  );
  assert.equal(
    methods["agents.migrate"].result.safeParse({ id, at: "2026-11-01T00:00:00Z", state: "committed", inventory })
      .success,
    true,
  );
  assert.equal(
    methods["agents.migrate"].result.safeParse({ id, at: "now", state: "working", inventory }).success,
    false,
  );
});
