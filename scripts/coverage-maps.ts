import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript-parser";
import type { CoverageSourceMap, V8Script } from "./test-coverage.ts";

export function readCoveragePayloads(directory: string): { scripts: V8Script[]; sourceMaps: CoverageSourceMap[] } {
  const scripts: V8Script[] = [];
  const sourceMaps: CoverageSourceMap[] = [];
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(directory, entry), "utf8")) as {
      result: V8Script[];
      sourceMaps?: CoverageSourceMap[];
    };
    scripts.push(...data.result);
    sourceMaps.push(...(data.sourceMaps ?? []));
  }
  return { scripts, sourceMaps };
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
