import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-parser";
import {
  ALLOWLIST_FILE,
  checkAllowlist,
  type PortabilityFinding,
  portabilityKind,
  readAllowlist,
  scanPortability,
  shrinkAllowlist,
} from "./test-portability.ts";

export type TestFinding = { file: string; line: number; reason: string };
const disabled = new Set(["skip", "todo", "only", "fixme"]);

/** AST lint: comments, translated labels and text fixtures are not test controls. */
export function scanTestSource(file: string, text: string): TestFinding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const roots = new Set(["test", "it", "describe", "suite"]);
  const contexts = new Set<string>();
  const assertions = new Set(["assert", "expect"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const name = element.propertyName?.text ?? element.name.text;
        if (roots.has(name)) roots.add(element.name.text);
        if (assertions.has(name)) assertions.add(element.name.text);
      }
    }
    const module = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
    if (module === "node:test" || module === "@playwright/test") {
      if (statement.importClause.name) roots.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) roots.add(bindings.name.text);
    }
    if (module.startsWith("node:assert") && statement.importClause.name)
      assertions.add(statement.importClause.name.text);
  }
  const findings: TestFinding[] = [];
  const add = (node: ts.Node, reason: string) =>
    findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason });
  const chain = (node: ts.Expression): string[] => {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isCallExpression(node)) return chain(node.expression);
    if (ts.isPropertyAccessExpression(node)) {
      const base = chain(node.expression);
      return base.length ? [...base, node.name.text] : [];
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
      const base = chain(node.expression);
      return base.length ? [...base, node.argumentExpression.text] : [];
    }
    return [];
  };
  const isTest = (node: ts.CallExpression) => {
    const names = chain(node.expression);
    return roots.has(names[0] ?? "") || (contexts.has(names[0] ?? "") && names[1] === "test");
  };
  const literal = (node: ts.Node): boolean =>
    ts.isLiteralExpression(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const names = chain(node.expression);
      if (contexts.has(names[0] ?? "") && disabled.has(names[1] ?? ""))
        add(node, `disabled or exclusive test: ${names[1]}`);
      if (isTest(node)) {
        const control = names.find((name) => disabled.has(name));
        if (control) add(node, `disabled or exclusive test: ${control}`);
        if (names.length === 1 && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0] as ts.Node))
          add(node, "test has no implementation");
        for (const argument of node.arguments) {
          if (!ts.isObjectLiteralExpression(argument)) continue;
          for (const property of argument.properties) {
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
            const name = property.name.getText(source).replaceAll(/["']/g, "");
            if (
              disabled.has(name) &&
              (!ts.isPropertyAssignment(property) || property.initializer.kind !== ts.SyntaxKind.FalseKeyword)
            )
              add(property, `disabled or exclusive test option: ${name}`);
          }
        }
        const callback = node.arguments.at(-1);
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const context = callback.parameters[0]?.name;
          if (context && ts.isIdentifier(context)) contexts.add(context.text);
        }
        if (
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          ts.isBlock(callback.body) &&
          callback.body.statements.length === 0
        )
          add(callback, "empty test callback");
      }
      if (
        assertions.has(names[0] ?? "") &&
        (names.at(-1) === "doesNotReject" || names.includes("rejects") || names.includes("resolves"))
      ) {
        let parent: ts.Node = node.parent;
        while (ts.isParenthesizedExpression(parent) || ts.isVoidExpression(parent)) parent = parent.parent;
        if (ts.isExpressionStatement(parent)) add(node, "async assertion must be awaited or returned");
      }
      const expectation =
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isCallExpression(node.expression.expression) &&
        assertions.has(chain(node.expression.expression.expression)[0] ?? "")
          ? node.expression.expression
          : undefined;
      if (expectation?.arguments.length && expectation.arguments.every(literal) && node.arguments.every(literal))
        add(node, "assertion only compares literals; it exercises no behavior");
      if (
        assertions.has(names[0] ?? "") &&
        (names.length === 1 ||
          ["ok", "equal", "strictEqual", "deepEqual", "deepStrictEqual"].includes(names.at(-1) ?? "")) &&
        node.arguments.length > 0 &&
        node.arguments.every(literal) &&
        !expectation &&
        !(ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent))
      )
        add(node, "assertion only compares literals; it exercises no behavior");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function repositoryFiles(root: string): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "apps", "packages", "scripts", "e2e"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)))
    .sort();
}

export function testFiles(root: string): string[] {
  return repositoryFiles(root)
    .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
    .map((file) => path.join(root, file));
}

export function checkTests(root: string): TestFinding[] {
  return testFiles(root).flatMap((file) => scanTestSource(path.relative(root, file), fs.readFileSync(file, "utf8")));
}

export function checkPortability(root: string): PortabilityFinding[] {
  return repositoryFiles(root).flatMap((file) =>
    portabilityKind(file) ? scanPortability(file, fs.readFileSync(path.join(root, file), "utf8")) : [],
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const findings = checkTests(root);
  for (const finding of findings) console.error(`${finding.file}:${finding.line}: ${finding.reason}`);
  const portable = checkPortability(root);
  const allow = readAllowlist();
  if (process.argv.includes("--shrink")) {
    const kept = shrinkAllowlist(allow, portable);
    const note = (JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8")) as { _note?: string })._note;
    fs.writeFileSync(ALLOWLIST_FILE, `${JSON.stringify({ _note: note, ...kept }, null, 2)}\n`);
  }
  const { extra, stale } = checkAllowlist(portable, process.argv.includes("--shrink") ? readAllowlist() : allow);
  for (const f of extra) console.error(`${f.file}:${f.line}: ${f.reason} (${f.rule}; AGENTS.md rule 26)`);
  for (const s of stale) console.error(`${s}: lower it in scripts/test-portability-allowlist.json (or run --shrink)`);
  if (findings.length || extra.length || stale.length) process.exitCode = 1;
  else
    console.log(
      "Test quality: no disabled/exclusive/empty tests or unawaited Node assertions; portable (rule 26) beyond the allowlist.",
    );
}
