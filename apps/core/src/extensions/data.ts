import path from "node:path";
import type { ExtensionRecord } from "../domain/extensions.ts";

/** Persistent state stays outside the fingerprinted package and survives updates. */
export const extensionMonitorDir = (e: ExtensionRecord) =>
  path.join(path.dirname(path.dirname(e.dir)), "extension-data", e.id, "monitor");
