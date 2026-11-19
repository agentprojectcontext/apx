import type { AgentMigration } from "../agent-migration/service.ts";
import type { Handlers } from "./router.ts";

export function agentMigrationHandlers(service: AgentMigration) {
  return {
    "agents.migration_preview": (params) => service.preview(params),
    "agents.migrate": (params) => service.move(params),
    "agents.migration_recover": ({ id }) => service.recover(id),
  } satisfies Pick<Handlers, "agents.migration_preview" | "agents.migrate" | "agents.migration_recover">;
}
