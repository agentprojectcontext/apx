// The APX Kit a surface asks for with <script src="/_apx/kit@1.js">: read once, inlined wherever the page is served.
import fs from "node:fs";
import path from "node:path";
import { inlineKit, usesKit } from "../../../packages/surfaces/src/kit.ts";

const KIT_DIR = path.resolve(import.meta.dirname, "../../../packages/surfaces/src/kit");
// The overlays extend window.APX, so they run after the main kit, in the same script.
const KIT_FILES = ["apx-kit.js", "apx-kit-overlays.js"].map((f) => path.join(KIT_DIR, f));
// The answer cards' styles, shared with the panel; they go after the kit's own so a widget's ax-card takes their look.
const CARDS_FILE = path.join(KIT_DIR, "apx-kit-cards.css");

let source: string | undefined;

/** Comments dropped and whitespace collapsed: the kit rides inside every widget. */
function compactCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,])\s*/g, "$1")
    .replace(/:\s+/g, ":")
    .trim();
}

function cardsScript(css: string): string {
  const text = JSON.stringify(compactCss(css)).replace(/</g, "\\u003c");
  return `(function(){if(document.getElementById('apx-kit-cards'))return;var s=document.createElement('style');s.id='apx-kit-cards';s.textContent=${text};(document.head||document.documentElement).appendChild(s)})();`;
}

export function kitSource(): string {
  source ??= [
    ...KIT_FILES.map((f) => fs.readFileSync(f, "utf8")),
    cardsScript(fs.readFileSync(CARDS_FILE, "utf8")),
  ].join("\n");
  return source;
}

/** The page as hosts show it: the kit inline when it asks for it, untouched otherwise. */
export function withKit(html: string): string {
  return usesKit(html) ? inlineKit(html, kitSource()) : html;
}
