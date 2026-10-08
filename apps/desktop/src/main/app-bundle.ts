import path from "node:path";

/** The running APX.app, when macOS lets this user replace it (not a disk image, not a translocated copy). */
export function replaceableBundle(execPath: string, canWrite: (dir: string) => boolean): string | undefined {
  const bundle = path.resolve(path.dirname(execPath), "..", "..");
  if (!bundle.endsWith(".app") || bundle.includes("/AppTranslocation/")) return undefined;
  return canWrite(path.dirname(bundle)) && canWrite(bundle) ? bundle : undefined;
}
