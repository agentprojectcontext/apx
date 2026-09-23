// apx usage — argument routing. See commands/usage.js.
import { cmdUsage } from "../commands/usage.js";

export default async function route(rest, { parseArgs }) {
  await cmdUsage(parseArgs(rest));
}
