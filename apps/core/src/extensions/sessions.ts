import fs from "node:fs";
import path from "node:path";
import type { ExtensionManifest } from "@apx/protocol";
import { badRequest, conflict } from "../errors.ts";
import { isMcpRemote } from "../mcp/bridge.ts";

/** Only the managed bridge has a session cache APX can safely identify and erase. */
export const hasManagedSession = (manifest: ExtensionManifest) => Object.values(manifest.mcp).some(isMcpRemote);

export function clearExtensionSession(home: string, id: string, manifest: ExtensionManifest): void {
  if (!hasManagedSession(manifest)) throw badRequest("This extension has no managed sign-in session");
  let dir = home;
  for (const part of ["extension-data", id]) {
    dir = path.join(dir, part);
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) throw conflict("The connection folder is a symbolic link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // rm removes a linked cache itself, never the directory it points to.
  fs.rmSync(path.join(dir, "mcp-remote"), { recursive: true, force: true });
}
