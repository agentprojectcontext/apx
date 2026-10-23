// The APX Kit a surface asks for with <script src="/_apx/kit@1.js">: read once, inlined wherever the page is served.
import fs from "node:fs";
import path from "node:path";
import { inlineKit, usesKit } from "../../../packages/surfaces/src/kit.ts";

// The overlays extend window.APX, so they run after the main kit, in the same script.
const KIT_FILES = ["apx-kit.js", "apx-kit-overlays.js"].map((f) =>
  path.resolve(import.meta.dirname, "../../../packages/surfaces/src/kit", f),
);

let source: string | undefined;

export function kitSource(): string {
  source ??= KIT_FILES.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  return source;
}

/** The page as hosts show it: the kit inline when it asks for it, untouched otherwise. */
export function withKit(html: string): string {
  return usesKit(html) ? inlineKit(html, kitSource()) : html;
}
