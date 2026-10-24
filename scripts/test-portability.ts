// AST lint for AGENTS.md rule 26 (portable tests): what made tests pass on one system and fail on another. Today's
// hits are in test-portability-allowlist.json as counts per file and rule; the gate fails on a new hit and on an
// allowance a file no longer needs, so the list only shrinks. A deliberate exception (never a short real-time
// window) carries `// portable: <why>` on its line or the line above.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript-parser";

export type PortabilityRule =
  | "raw-rm"
  | "raw-mkdtemp"
  | "local-wait"
  | "counted-poll"
  | "short-window"
  | "path-prefix"
  | "process-exit";

export type PortabilityFinding = { file: string; line: number; rule: PortabilityRule; reason: string };

const REASONS: Record<PortabilityRule, string> = {
  "raw-rm": "a recursive rm in a test: use tempDir()/removeDir(), which wait out a folder Windows still holds",
  "raw-mkdtemp": "a temp folder made by hand: use tempDir(), removed only after the test's processes exited",
  "local-wait": "a local polling helper: use waitFor() from the testkit (wall-clock budget × TEST_TIME_SCALE)",
  "counted-poll": "a wait capped by a number of tries: a slow machine runs out of tries; use waitFor()",
  "short-window": "a real-time window under 2 s decides the outcome: inject runTimers (manualTimers)",
  "path-prefix": "a path compared as a string prefix: use isInside()/samePath() (any case and both slashes on Windows)",
  "process-exit": "process.exit with handles open crashes libuv on Windows: use exitWhenClosed()",
};

/** Files whose job is the very thing a rule forbids elsewhere. */
const HOMES: Partial<Record<PortabilityRule, RegExp>> = {
  "raw-rm": /^apps\/core\/src\/testkit\//,
  "raw-mkdtemp": /^apps\/core\/src\/testkit\//,
  "local-wait": /^apps\/core\/src\/testkit\//,
  "path-prefix": /^apps\/core\/src\/paths\.ts$/,
  "process-exit": /^packages\/protocol\/src\/exit\.ts$/,
};

const WINDOW = /(idle|cap|burst|deadline|timeout)ms$/i;
const WAITERS = /^(until|waitFor|waitUntil|eventually|poll|wait)$/;

const isTestFile = (file: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
/** Product code: what ships, apart from tests and their stand-ins. */
const isProductFile = (file: string) =>
  /^(apps\/[^/]+|packages\/[^/]+)\/src\//.test(file) &&
  /\.[cm]?[jt]sx?$/.test(file) &&
  !isTestFile(file) &&
  !/\.test-support\./.test(file) &&
  !/^apps\/core\/src\/testkit\//.test(file);

export function portabilityKind(file: string): "test" | "product" | undefined {
  if (isTestFile(file)) return "test";
  if (isProductFile(file)) return "product";
  return undefined;
}

/** Names of a call's callee, outermost last: `fs.promises.rm` → ["fs", "promises", "rm"]. */
function callee(node: ts.Expression): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...callee(node.expression), node.name.text];
  return [];
}

const hasLoop = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isWhileStatement(n) || ts.isForStatement(n) || ts.isDoStatement(n)) found = true;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

const sleeps = (node: ts.Node): boolean => /\b(setTimeout|setImmediate|sleep|pause|delay)\b/.test(node.getText());

/** A path's separator as a prefix's tail: `${root}${path.sep}`, `${root}/`, root + path.sep, root + "/". */
function prefixWithSep(arg: ts.Expression): boolean {
  const sepText = (t: string) => t === "/" || t === "\\" || t === "\\\\";
  if (ts.isTemplateExpression(arg)) {
    if (arg.head.text !== "") return false;
    const last = arg.templateSpans.at(-1);
    if (!last) return false;
    if (sepText(last.literal.text)) return true;
    return last.literal.text === "" && last.expression.getText() === "path.sep";
  }
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const r = arg.right;
    return r.getText() === "path.sep" || (ts.isStringLiteral(r) && sepText(r.text));
  }
  return false;
}

export function scanPortability(file: string, text: string, kind = portabilityKind(file)): PortabilityFinding[] {
  if (!kind) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const findings: PortabilityFinding[] = [];
  const injected = /\brunTimers\b/.test(text);
  const consts = new Map<string, number>();
  for (const s of source.statements)
    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && ts.isNumericLiteral(d.initializer))
          consts.set(d.name.text, Number(d.initializer.text.replaceAll("_", "")));
  const add = (node: ts.Node, rule: PortabilityRule) => {
    if (HOMES[rule]?.test(file)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    // A real-time window has no good reason: no comment excuses it, only injected timers do.
    const marked = /\/\/ portable:/.test(lines[line] ?? "") || /^\s*\/\/ portable:/.test(lines[line - 1] ?? "");
    if (marked && rule !== "short-window") return;
    findings.push({ file, line: line + 1, rule, reason: REASONS[rule] });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const names = callee(node.expression);
      const last = names.at(-1) ?? "";
      if (kind === "product" && names.join(".") === "process.exit") add(node, "process-exit");
      if (
        kind === "product" &&
        last === "startsWith" &&
        node.arguments[0] &&
        prefixWithSep(node.arguments[0] as ts.Expression)
      )
        add(node, "path-prefix");
      if (kind === "test" && (last === "rmSync" || (last === "rm" && names.includes("promises")))) {
        const opts = node.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts) && /\brecursive\b/.test(opts.getText())) add(node, "raw-rm");
      }
      if (kind === "test" && (last === "mkdtempSync" || last === "mkdtemp") && /tmpdir\(\)/.test(node.getText()))
        add(node, "raw-mkdtemp");
    }
    if (kind === "test") {
      let name: string | undefined;
      let body: ts.Node | undefined;
      if (ts.isFunctionDeclaration(node) && node.name) [name, body] = [node.name.text, node];
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      )
        [name, body] = [node.name.text, node.initializer];
      if (name && body && WAITERS.test(name) && hasLoop(body)) add(node, "local-wait");
      if (ts.isForStatement(node) && node.condition && sleeps(node.statement)) {
        const bound = (n: ts.Node): boolean =>
          (ts.isBinaryExpression(n) &&
            (n.operatorToken.kind === ts.SyntaxKind.LessThanToken ||
              n.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken) &&
            ts.isNumericLiteral(n.right)) ||
          (ts.isBinaryExpression(n) &&
            n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            (bound(n.left) || bound(n.right)));
        if (bound(node.condition)) add(node, "counted-poll");
      }
      if (ts.isPropertyAssignment(node) && !injected) {
        const prop = node.name.getText(source).replaceAll(/["'_]/g, "");
        const init = node.initializer;
        const value = ts.isNumericLiteral(init)
          ? Number(init.text.replaceAll("_", ""))
          : ts.isIdentifier(init)
            ? consts.get(init.text)
            : undefined;
        if (WINDOW.test(prop) && value !== undefined && value < 2000) add(node, "short-window");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export type Allowlist = Partial<Record<PortabilityRule, Record<string, number>>>;

/** Hits beyond each file's allowance, and allowances no longer needed (so the list is shrunk as files are fixed). */
export function checkAllowlist(
  findings: PortabilityFinding[],
  allow: Allowlist,
): { extra: PortabilityFinding[]; stale: string[] } {
  const counts = new Map<string, PortabilityFinding[]>();
  for (const f of findings) {
    const key = `${f.rule}\0${f.file}`;
    counts.set(key, [...(counts.get(key) ?? []), f]);
  }
  const extra: PortabilityFinding[] = [];
  for (const [key, hits] of counts) {
    const [rule, file] = key.split("\0") as [PortabilityRule, string];
    const allowed = allow[rule]?.[file] ?? 0;
    if (hits.length > allowed) extra.push(...hits);
  }
  const stale: string[] = [];
  for (const [rule, files] of Object.entries(allow) as Array<[PortabilityRule, Record<string, number>]>)
    for (const [file, allowed] of Object.entries(files)) {
      const found = counts.get(`${rule}\0${file}`)?.length ?? 0;
      if (found < allowed) stale.push(`${file}: ${rule} allows ${allowed}, found ${found}`);
    }
  return { extra, stale };
}

export const ALLOWLIST_FILE = path.join(import.meta.dirname, "test-portability-allowlist.json");

export function readAllowlist(file = ALLOWLIST_FILE): Allowlist {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const { _note: _, ...rules } = raw;
  return rules as Allowlist;
}

/** The allowlist cut down to what `findings` still need (`--shrink`); it never allows anything new. */
export function shrinkAllowlist(allow: Allowlist, findings: PortabilityFinding[]): Allowlist {
  const out: Allowlist = {};
  for (const [rule, files] of Object.entries(allow) as Array<[PortabilityRule, Record<string, number>]>)
    for (const [file, allowed] of Object.entries(files)) {
      const left = Math.min(allowed, findings.filter((f) => f.rule === rule && f.file === file).length);
      if (left === 0) continue;
      out[rule] = { ...out[rule], [file]: left };
    }
  return out;
}
