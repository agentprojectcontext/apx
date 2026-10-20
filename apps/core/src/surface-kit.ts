// The APX Kit a surface asks for with <script src="/_apx/kit@1.js">: read once, inlined wherever the page is served.
import fs from "node:fs";
import path from "node:path";
import { inlineKit, usesKit } from "../../../packages/surfaces/src/kit.ts";

const KIT_FILE = path.resolve(import.meta.dirname, "../../../packages/surfaces/src/kit/apx-kit.js");

let source: string | undefined;

export function kitSource(): string {
  source ??= fs.readFileSync(KIT_FILE, "utf8");
  return source;
}

/** The page as hosts show it: the kit inline when it asks for it, untouched otherwise. */
export function withKit(html: string): string {
  return usesKit(html) ? inlineKit(html, kitSource()) : html;
}
