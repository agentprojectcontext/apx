import { loadConfig } from "../config.ts";
import { repairOfflineDatabase } from "./doctor-repair.ts";

try {
  process.stdout.write(`${JSON.stringify(repairOfflineDatabase(loadConfig().home))}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
