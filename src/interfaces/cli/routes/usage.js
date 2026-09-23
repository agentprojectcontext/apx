// apx usage — argument routing. See commands/usage.js.
import { cmdUsage, cmdUsageBreaker, cmdUsageResume } from "../commands/usage.js";

export default async function route(rest, { parseArgs }) {
  if (rest[0] === "breaker") return cmdUsageBreaker();
  if (rest[0] === "resume") return cmdUsageResume();
  await cmdUsage(parseArgs(rest));
}
