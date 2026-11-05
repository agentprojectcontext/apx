#!/usr/bin/env node
// `pnpm check:ui`: screens in apps/web/src are built from packages/ui. It fails on a native control where the design
// system has a component (<button>, <select>, <textarea>, a text or checkbox <input>) and on a literal colour (hex,
// rgb(), hsl(), oklch()) in a style, class or stylesheet instead of a token. Today's hits sit in
// check-ui-allowlist.json as counts per file and rule, each with its reason; the gate fails on a new hit and on an
// allowance a file no longer needs, so the list only shrinks. A deliberate exception carries `ui: <why>` in a comment
// on its line or the line above. data-testid is not banned: the e2e suite finds elements by it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-parser";

export type UiRule = "native-control" | "literal-color";
export type UiFinding = { file: string; line: number; rule: UiRule; reason: string };
export type UiAllowlist = Partial<Record<UiRule, Record<string, { count: number; reason: string }>>>;

export const ALLOWLIST_FILE = path.join(import.meta.dirname, "check-ui-allowlist.json");

const COMPONENT: Record<string, string> = {
  button: "Button or IconButton",
  select: "Select",
  textarea: "Textarea",
  input: "Input, SearchField, Checkbox or Switch",
};
/** Input types the design system has no component for. */
const FREE_INPUTS = new Set(["file", "hidden", "range", "color", "radio"]);
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;
const MARK = /\bui:\s*\S/;

export const isScreenFile = (file: string) =>
  /^apps\/web\/src\//.test(file) &&
  /\.(tsx?|css)$/.test(file) &&
  !/\.(test|spec)\.[jt]sx?$/.test(file) &&
  !/\.d\.ts$/.test(file);

function marked(lines: string[], line: number): boolean {
  return MARK.test(lines[line - 1] ?? "") || MARK.test(lines[line - 2] ?? "");
}

function scanCss(file: string, text: string): UiFinding[] {
  const lines = text.split("\n");
  const findings: UiFinding[] = [];
  // Blank out comments, keeping line breaks so line numbers hold.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const declaration = /([\w-]+)\s*:([^;{}]*)/g;
  for (const match of code.matchAll(declaration)) {
    const [, property = "", value = ""] = match;
    // A mask only reads alpha, so its black is not a colour on screen.
    if (/^(-webkit-)?mask/.test(property) || !COLOR.test(value)) continue;
    const line = code.slice(0, (match.index ?? 0) + property.length + 1 + value.search(COLOR)).split("\n").length;
    if (marked(lines, line)) continue;
    findings.push({ file, line, rule: "literal-color", reason: `${property}: a literal colour; use an --apx-* token` });
  }
  return findings;
}

function scanScript(file: string, text: string): UiFinding[] {
  const lines = text.split("\n");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: UiFinding[] = [];
  const add = (node: ts.Node, rule: UiRule, reason: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (!marked(lines, line)) findings.push({ file, line, rule, reason });
  };
  const attribute = (node: ts.JsxOpeningLikeElement, name: string) => {
    for (const a of node.attributes.properties)
      if (ts.isJsxAttribute(a) && a.name.getText(source) === name) return a.initializer;
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const component = COMPONENT[tag];
      const type = attribute(node, "type");
      const free = tag === "input" && type && ts.isStringLiteral(type) && FREE_INPUTS.has(type.text);
      if (component && !free) add(node, "native-control", `native <${tag}>: use ${component} from @apx/ui`);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) &&
      COLOR.test(node.text)
    )
      add(node, "literal-color", "a literal colour: use an --apx-* token");
    if ((ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && COLOR.test(node.text))
      add(node, "literal-color", "a literal colour: use an --apx-* token");
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function scanUi(file: string, text: string): UiFinding[] {
  if (!isScreenFile(file)) return [];
  return file.endsWith(".css") ? scanCss(file, text) : scanScript(file, text);
}

export function readAllowlist(file = ALLOWLIST_FILE): UiAllowlist {
  const { _note: _, ...rules } = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  return rules as UiAllowlist;
}

/** New hits beyond a file's allowance, and allowances larger than what is left (the list only shrinks). */
export function checkAllowlist(findings: UiFinding[], allow: UiAllowlist) {
  const counts = new Map<string, UiFinding[]>();
  for (const f of findings) {
    const key = `${f.rule}\0${f.file}`;
    counts.set(key, [...(counts.get(key) ?? []), f]);
  }
  const extra: UiFinding[] = [];
  for (const [key, hits] of counts) {
    const [rule, file] = key.split("\0") as [UiRule, string];
    if (hits.length > (allow[rule]?.[file]?.count ?? 0)) extra.push(...hits);
  }
  const stale: string[] = [];
  for (const [rule, files] of Object.entries(allow) as Array<[UiRule, Record<string, { count: number }>]>)
    for (const [file, { count }] of Object.entries(files)) {
      const found = counts.get(`${rule}\0${file}`)?.length ?? 0;
      if (found < count) stale.push(`${file}: ${rule} allows ${count}, found ${found}`);
    }
  return { extra, stale };
}

export function shrinkAllowlist(allow: UiAllowlist, findings: UiFinding[]): UiAllowlist {
  const out: UiAllowlist = {};
  for (const [rule, files] of Object.entries(allow) as Array<
    [UiRule, Record<string, { count: number; reason: string }>]
  >)
    for (const [file, entry] of Object.entries(files)) {
      const left = Math.min(entry.count, findings.filter((f) => f.rule === rule && f.file === file).length);
      if (left) out[rule] = { ...out[rule], [file]: { ...entry, count: left } };
    }
  return out;
}

export function checkUi(root: string): UiFinding[] {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps/web/src"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) => isScreenFile(file) && fs.existsSync(path.join(root, file)))
    .sort()
    .flatMap((file) => scanUi(file, fs.readFileSync(path.join(root, file), "utf8")));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkUi(path.resolve(import.meta.dirname, ".."));
  if (process.argv.includes("--shrink")) {
    const note = (JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8")) as { _note?: string })._note;
    const kept = shrinkAllowlist(readAllowlist(), findings);
    fs.writeFileSync(ALLOWLIST_FILE, `${JSON.stringify({ _note: note, ...kept }, null, 2)}\n`);
  }
  const { extra, stale } = checkAllowlist(findings, readAllowlist());
  for (const f of extra) console.error(`${f.file}:${f.line}: ${f.reason} (${f.rule})`);
  for (const s of stale) console.error(`${s}: lower it in scripts/check-ui-allowlist.json (or run --shrink)`);
  if (extra.length || stale.length) process.exitCode = 1;
  else console.log("UI: screens use @apx/ui controls and tokens beyond the allowlist.");
}
