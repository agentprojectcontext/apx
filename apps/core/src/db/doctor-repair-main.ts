import { loadConfig } from "../config.ts";
import { repairOfflineDatabase } from "./doctor-repair.ts";
import { diagnoseOfflineSchema } from "./doctor-schema.ts";

try {
  const home = loadConfig().home;
  const result = process.argv[2] === "--schema" ? diagnoseOfflineSchema(home) : repairOfflineDatabase(home);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
