// What the panel downloads before its first screen, read from the built dist/: the files index.html names, every chunk
// they import statically, and the language chunk main.tsx waits for (with its own static imports). `pnpm perf` budgets
// it and, when it is over, names the chunks and the modules inside them that weigh the most.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import ts from "typescript-parser";

type Mapping = { generatedLine: number; generatedCharacter: number; sourceIndex?: number };
const { decodeMappings } = ts as typeof ts & { decodeMappings: (mappings: string) => Iterable<Mapping> };

/** The languages main.tsx can wait for; each is its own chunk, named after its file (i18n/en.ts → en-<hash>.js). */
const LANGUAGE_CHUNK = /^assets\/(en|es)-[\w-]+\.js$/;

export type Boot = {
  /** The files index.html names (entry script and stylesheet) and the chunks they import statically. */
  initial: string[];
  /** Per language: its chunk and the chunks it imports statically that the initial files do not already bring. */
  languages: Record<string, string[]>;
  /** Initial files plus the heaviest language: what a first screen downloads in the worst case. */
  files: string[];
};

const read = (dist: string, file: string) => fs.readFileSync(path.join(dist, file), "utf8");

/** Static `import … from "./x.js"` and `import "./x.js"` of a chunk, as dist paths (`import("./x.js")` is lazy). */
export function staticImports(code: string): string[] {
  return [
    ...new Set(
      Array.from(code.matchAll(/(?:\bimport|\bfrom)\s*["'`]\.\/([^"'`]+\.js)["'`]/g), (m) => `assets/${m[1]}`),
    ),
  ];
}

/** Chunks a chunk may load later (`import("./x.js")`), as dist paths. */
export function dynamicImports(code: string): string[] {
  return [
    ...new Set(Array.from(code.matchAll(/\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g), (m) => `assets/${m[1]}`)),
  ];
}

function closure(dist: string, start: string[]): string[] {
  const seen = new Set<string>();
  const todo = [...start];
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith(".js")) todo.push(...staticImports(read(dist, file)));
  }
  return [...seen];
}

export const gzipKb = (dist: string, file: string) =>
  zlib.gzipSync(fs.readFileSync(path.join(dist, file))).length / 1024;
export const sumKb = (dist: string, files: string[]) => files.reduce((acc, f) => acc + gzipKb(dist, f), 0);

/** The first load's files, or undefined when there is no build. */
export function bootFiles(dist: string): Boot | undefined {
  if (!fs.existsSync(path.join(dist, "index.html"))) return;
  const named = Array.from(
    read(dist, "index.html").matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g),
    (m) => m[1] ?? "",
  );
  const initial = closure(dist, named);
  const lazy = new Set(initial.filter((f) => f.endsWith(".js")).flatMap((f) => dynamicImports(read(dist, f))));
  const languages: Record<string, string[]> = {};
  for (const file of lazy) {
    const lang = LANGUAGE_CHUNK.exec(file)?.[1];
    if (lang) languages[lang] = closure(dist, [file]).filter((f) => !initial.includes(f));
  }
  const heaviest = Object.values(languages).sort((a, b) => sumKb(dist, b) - sumKb(dist, a))[0] ?? [];
  return { initial, languages, files: [...initial, ...heaviest] };
}

/** Who a source file belongs to: its npm package, a workspace package's build, or its path in the repo. */
export function owner(file: string): string {
  // A path resolved on Windows has backslashes; the patterns below read it with slashes.
  const source = file.replaceAll("\\", "/");
  const at = source.lastIndexOf("node_modules/");
  if (at >= 0) {
    const [scope = "", name = ""] = source.slice(at + "node_modules/".length).split("/");
    return scope.startsWith("@") ? `${scope}/${name}` : scope;
  }
  const built = source.match(/packages\/([^/]+)\/dist\//)?.[1];
  if (built) return `@apx/${built}`;
  return source.match(/(?:apps|packages)\/.*$/)?.[0] ?? source;
}

/** Minified bytes per package or file in a chunk, from its sourcemap; undefined without one. */
export function moduleBytes(dist: string, file: string): Map<string, number> | undefined {
  const mapFile = path.join(dist, `${file}.map`);
  if (!fs.existsSync(mapFile)) return;
  const map = JSON.parse(fs.readFileSync(mapFile, "utf8")) as { sources: string[]; mappings: string };
  const lines = read(dist, file).split("\n");
  const bytes = new Map<string, number>();
  const segments = [...decodeMappings(map.mappings)];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] as Mapping;
    const next = segments[i + 1];
    const end =
      next && next.generatedLine === s.generatedLine
        ? next.generatedCharacter
        : (lines[s.generatedLine]?.length ?? s.generatedCharacter);
    const source = s.sourceIndex === undefined ? undefined : map.sources[s.sourceIndex];
    const who = source === undefined ? "(unmapped)" : owner(path.resolve(path.dirname(mapFile), source));
    bytes.set(who, (bytes.get(who) ?? 0) + end - s.generatedCharacter);
  }
  return bytes;
}

/** Packages or files whose code is in any of these chunks (from their sourcemaps). */
export function owners(dist: string, files: string[]): Set<string> | undefined {
  const all = new Set<string>();
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const bytes = moduleBytes(dist, file);
    if (!bytes) return;
    for (const who of bytes.keys()) all.add(who);
  }
  return all;
}

/** The report printed when the first load is over budget: each chunk's size, then the heaviest packages or files. */
export function bootReport(dist: string, boot: Boot, top = 5): string {
  const lines = boot.files
    .map((f) => [f, gzipKb(dist, f)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([f, kb]) => `    ${kb.toFixed(1).padStart(7)} KB gz  ${f}`);
  const bytes = new Map<string, number>();
  let mapped = true;
  for (const file of boot.files.filter((f) => f.endsWith(".js"))) {
    const per = moduleBytes(dist, file);
    if (!per) {
      mapped = false;
      break;
    }
    for (const [who, n] of per) bytes.set(who, (bytes.get(who) ?? 0) + n);
  }
  if (!mapped) return [...lines, "    (build with APX_TEST_COVERAGE=1 for a sourcemap to name the modules)"].join("\n");
  const heaviest = [...bytes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([who, n]) => `    ${(n / 1024).toFixed(1).padStart(7)} KB min ${who}`);
  return [...lines, "  heaviest packages or files:", ...heaviest].join("\n");
}

/** zod's own class names, kept as strings in a minified build: how a build without a sourcemap still shows it. */
const ZOD_MARK = "$ZodType";

/**
 * What must never be on the first load: zod (the protocol's schemas, only screens that validate need them) and the
 * named lazy screens, each of which must stay a chunk of its own outside it.
 */
export function bootProblems(dist: string, boot: Boot, lazyScreens: string[]): string[] {
  const problems: string[] = [];
  const js = boot.files.filter((f) => f.endsWith(".js"));
  const zod = owners(dist, js)?.has("zod") ?? js.some((f) => read(dist, f).includes(ZOD_MARK));
  if (zod) problems.push("zod is on the first load: import a subpath of @apx/protocol that has no schemas");
  const chunks = fs.readdirSync(path.join(dist, "assets")).map((f) => `assets/${f}`);
  for (const screen of lazyScreens) {
    const own = chunks.filter((f) => f.startsWith(`assets/${screen}-`) && f.endsWith(".js"));
    if (!own.length) problems.push(`${screen} has no chunk of its own: something on the first screen imports it`);
    else if (own.some((f) => boot.files.includes(f))) problems.push(`${screen} is on the first load`);
  }
  return problems;
}
