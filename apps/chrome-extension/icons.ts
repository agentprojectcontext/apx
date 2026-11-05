import { readFileSync } from "node:fs";
import path from "node:path";

export const ICON_SIZES = [16, 32, 48, 128] as const;
export const ICON_PATHS = Object.fromEntries(ICON_SIZES.map((size) => [size, `assets/icon-${size}.png`]));

/** Generated from APX's transparent favicon; Chrome requires raster extension icons. */
export function extensionIcons(): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.values(ICON_PATHS).map((file) => [file, readFileSync(path.join(import.meta.dirname, file))]),
  );
}
