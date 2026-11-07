import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript-parser";
import type { CoverageSourceMap, V8Script } from "./test-coverage.ts";

type V8Function = V8Script["functions"][number];

/** Folds one process's scripts in: per function range, the run that counted most (as many runs share a module). */
function foldScripts(merged: Map<string, Map<string, V8Function>>, scripts: V8Script[]): void {
  for (const script of scripts) {
    const functions = merged.get(script.url) ?? new Map<string, V8Function>();
    for (const fn of script.functions) {
      const range = fn.ranges[0];
      if (!range) continue;
      const key = `${range.startOffset}:${range.endOffset}`;
      const old = functions.get(key);
      if (!old || range.count > (old.ranges[0]?.count ?? 0)) functions.set(key, fn);
    }
    merged.set(script.url, functions);
  }
}

export function mergeScripts(scripts: V8Script[]): V8Script[] {
  const merged = new Map<string, Map<string, V8Function>>();
  foldScripts(merged, scripts);
  return [...merged].map(([url, functions]) => ({ url, functions: [...functions.values()] }));
}

/** Every process's counters, merged file by file: a full run writes gigabytes, more than fit in memory at once. */
export function readCoveragePayloads(directory: string): { scripts: V8Script[]; sourceMaps: CoverageSourceMap[] } {
  const merged = new Map<string, Map<string, V8Function>>();
  const sourceMaps = new Map<string, CoverageSourceMap>();
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(directory, entry), "utf8")) as {
      result: V8Script[];
      sourceMaps?: CoverageSourceMap[];
    };
    foldScripts(merged, data.result);
    for (const map of data.sourceMaps ?? []) sourceMaps.set(map.url, map);
  }
  const scripts = [...merged].map(([url, functions]) => ({ url, functions: [...functions.values()] }));
  return { scripts, sourceMaps: [...sourceMaps.values()] };
}

/** Keep generated text and mappings together before another build can replace dist/. */
export function snapshotSourceMaps(directory: string): CoverageSourceMap[] {
  const maps: CoverageSourceMap[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) maps.push(...snapshotSourceMaps(file));
    else if (/\.[cm]?js\.map$/.test(file)) {
      const generated = file.slice(0, -4);
      const map = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<CoverageSourceMap, "url" | "text">;
      maps.push({ ...map, url: pathToFileURL(generated).href, text: fs.readFileSync(generated, "utf8") });
    }
  }
  return maps;
}

export function missingSourceMaps(root: string, urls: string[], maps: CoverageSourceMap[]): string[] {
  const saved = new Set(maps.map((map) => map.url));
  const missing = new Set<string>();
  const referenced = maps.flatMap((map) => {
    const base = map.sourceRoot ? new URL(`${map.sourceRoot.replace(/\/$/, "")}/`, map.url) : new URL(map.url);
    return map.sources.map((source) => new URL(source, base).href);
  });
  for (const url of [...urls, ...referenced]) {
    if (!url.startsWith("file:") || saved.has(url)) continue;
    const file = path.relative(root, fileURLToPath(url)).split(path.sep).join("/");
    if (/^(apps\/(web|desktop)|packages\/ui)\/dist\/.*\.[cm]?js$/.test(file)) missing.add(file);
  }
  return [...missing].sort();
}

export const COVERAGE_CHUNKS_FILE = "coverage-chunks.json";

/** Compiler facades contain only static imports and re-exports, with no source functions to count. */
function reexportFacade(directory: string, file: string): boolean {
  if (!/^assets\/[\w.-]+\.js$/.test(file)) return false;
  try {
    const code = fs.readFileSync(path.join(directory, file), "utf8");
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const { diagnostics } = ts.transpileModule(code, { reportDiagnostics: true });
    if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) return false;
    return (
      source.statements.length > 0 &&
      source.statements.every((statement) => {
        if (ts.isImportDeclaration(statement)) return ts.isStringLiteral(statement.moduleSpecifier);
        if (!ts.isExportDeclaration(statement)) return false;
        if (statement.moduleSpecifier) return ts.isStringLiteral(statement.moduleSpecifier);
        return (
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every(
            (element) =>
              ts.isIdentifier(element.name) && (!element.propertyName || ts.isIdentifier(element.propertyName)),
          )
        );
      })
    );
  } catch {
    return false;
  }
}

/** Compiler provenance must prove that a chunk has no first-party function inventory. */
export function compilerGeneratedChunks(directory: string): ReadonlySet<string> {
  try {
    const chunks: unknown = JSON.parse(fs.readFileSync(path.join(directory, COVERAGE_CHUNKS_FILE), "utf8"));
    if (!chunks || typeof chunks !== "object" || Array.isArray(chunks)) return new Set();
    return new Set(
      Object.entries(chunks).flatMap(([file, modules]) =>
        Array.isArray(modules) &&
        ((modules.length === 1 && modules[0] === "\0rolldown/runtime.js") ||
          (modules.length === 0 && reexportFacade(directory, file)))
          ? [file]
          : [],
      ),
    );
  } catch {
    return new Set();
  }
}
