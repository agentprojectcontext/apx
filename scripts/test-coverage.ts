import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-parser";
import { missingSourceMaps, readCoveragePayloads, snapshotSourceMaps } from "./coverage-maps.ts";
import { sourceMapResolver } from "./coverage-source-map.ts";
import { checkTests, repositoryFiles, testFiles } from "./test-quality.ts";

type V8Function = { functionName: string; ranges: { startOffset: number; endOffset: number; count: number }[] };
export type V8Script = { url: string; functions: V8Function[] };
export type FunctionCoverage = { name: string; line: number; covered: boolean };
export type FileCoverage = { file: string; loaded: boolean; functions: FunctionCoverage[] };
export type InstrumentedCoverage = {
  path: string;
  fnMap: Record<string, { decl: { start: { line: number; column: number } } }>;
  f: Record<string, number>;
  s: Record<string, number>;
};
type SourceFunction = FunctionCoverage & { start: number; end: number };
export type CoverageSourceMap = { url: string; text: string; sources: string[]; mappings: string; sourceRoot?: string };
/** Parallel checkouts need separate sandbox listeners; explicit ports remain available for debugging. */
export async function sandboxPorts(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const ports: Record<string, string> = {};
  const servers: net.Server[] = [];
  try {
    for (const name of ["E2E_PORT", "E2E_CONTROL_PORT", "E2E_WA_PORT"]) {
      if (env[name]) {
        ports[name] = env[name];
        continue;
      }
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      ports[name] = String((server.address() as net.AddressInfo).port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

function lineStarts(text: string): number[] {
  return [0, ...Array.from(text.matchAll(/\r\n?|\n/g), (match) => match.index + match[0].length)];
}

function mergeScripts(scripts: V8Script[]): V8Script[] {
  const merged = new Map<string, Map<string, V8Function>>();
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
  return [...merged].map(([url, functions]) => ({ url, functions: [...functions.values()] }));
}

function sourceFiles(root: string): string[] {
  return repositoryFiles(root)
    .filter(
      (file) =>
        !file.startsWith("e2e/") && /\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec|test-support)\.|\.d\.ts$/.test(file),
    )
    .map((file) => path.join(root, file));
}

function sourceFunctions(file: string, text: string): SourceFunction[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const functions: SourceFunction[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)) &&
      node.body
    ) {
      const parent = node.parent;
      const name =
        "name" in node && node.name
          ? node.name.getText(source)
          : ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)
            ? parent.name.getText(source)
            : "(anonymous)";
      functions.push({
        name,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        covered: false,
        start: node.getStart(source),
        end: node.end,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return functions;
}

/** Union coverage across test processes; never-loaded modules remain explicit zeroes. */
export function coverageReport(
  root: string,
  files: { file: string; text: string }[],
  scripts: V8Script[],
  sourceMaps: CoverageSourceMap[] = [],
  instrumented: InstrumentedCoverage[] = [],
): FileCoverage[] {
  const inventory = new Map(
    files.map(({ file, text }) => [
      file,
      { text, lines: lineStarts(text), functions: sourceFunctions(file, text), loaded: false },
    ]),
  );
  const relative = (url: string) => path.relative(root, fileURLToPath(url)).split(path.sep).join("/");
  const own = (file: string, offset: number, covered: boolean) => {
    const source = inventory.get(file);
    if (!source) return;
    source.loaded = true;
    const containing = source.functions
      .filter((f) => f.start <= offset && offset < f.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (containing && covered) containing.covered = true;
  };
  const resolveSource = sourceMapResolver(root, files, sourceMaps);
  for (const script of mergeScripts(scripts)) {
    if (!script.url.startsWith("file:")) continue;
    let file: string;
    try {
      file = relative(script.url);
    } catch {
      continue;
    }
    const original = inventory.get(file);
    if (original) original.loaded = true;
    for (const fn of script.functions) {
      const range = fn.ranges[0];
      if (!range || (!fn.functionName && range.startOffset === 0)) continue;
      if (original) {
        own(file, range.startOffset, range.count > 0);
        continue;
      }
      const source = resolveSource(script.url, range.startOffset, range.endOffset);
      if (source) own(source.file, source.offset, range.count > 0);
    }
  }
  // Expo's Babel instrumentation retains nested TSX callbacks that V8's transformed-file maps omit.
  for (const entry of instrumented) {
    const file = path.relative(root, entry.path).split(path.sep).join("/");
    const source = inventory.get(file);
    if (!source) continue;
    source.loaded ||= Object.values(entry.s).some((count) => count > 0);
    for (const [id, fn] of Object.entries(entry.fnMap)) {
      if (!(entry.f[id] && entry.f[id] > 0)) continue;
      const { line, column } = fn.decl.start;
      const start = source.lines[line - 1];
      if (start !== undefined) own(file, start + column, true);
    }
  }
  return [...inventory]
    .map(([file, source]) => ({
      file,
      loaded: source.loaded,
      functions: source.functions.map(({ name, line, covered }) => ({ name, line, covered })),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function coverageMarkdown(report: FileCoverage[]): string {
  const groups = new Map<string, { covered: number; total: number; loaded: number; files: number }>();
  for (const row of report) {
    const area = row.file.startsWith("scripts/") ? "scripts" : row.file.split("/").slice(0, 2).join("/");
    const stats = groups.get(area) ?? { covered: 0, total: 0, loaded: 0, files: 0 };
    stats.files++;
    if (row.loaded) stats.loaded++;
    stats.total += row.functions.length;
    stats.covered += row.functions.filter((f) => f.covered).length;
    groups.set(area, stats);
  }
  const lines = [
    "# Function execution coverage",
    "",
    "Runtime execution is evidence of a call, not evidence of a useful assertion. Unloaded files are included; types and declarations have no executable functions. Browser-rendered components need the E2E suite as well.",
    "",
    "| Area | Loaded files | Executed functions |",
    "|---|---:|---:|",
  ];
  for (const [area, stats] of groups)
    lines.push(`| ${area} | ${stats.loaded}/${stats.files} | ${stats.covered}/${stats.total} |`);
  lines.push("", "## Unexecuted functions", "");
  for (const row of report) {
    const missed = row.functions.filter((f) => !f.covered);
    if (!missed.length) continue;
    lines.push(
      `### ${row.file}${row.loaded ? "" : " (never loaded)"}`,
      "",
      ...missed.map((f) => `- L${f.line}: ${f.name}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** What a run covers: everything (the default), or one part of the --e2e run on a machine of its own in CI. */
export type CoveragePart = { unit: boolean; web: boolean | string; desktop: boolean };

/** `--part=unit|web|desktop` (web takes `--shard=i/n`, Playwright's); without it, every suite the flags ask for. */
export function coveragePart(argv: readonly string[]): CoveragePart & { name?: string } {
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const part = flag("part");
  if (!part) return { unit: true, web: argv.includes("--e2e"), desktop: argv.includes("--e2e") };
  const shard = flag("shard");
  if (part === "unit") return { name: "unit", unit: true, web: false, desktop: false };
  if (part === "desktop") return { name: "desktop", unit: false, web: false, desktop: true };
  if (part === "web")
    return {
      name: shard ? `web-${shard.replace("/", "-of-")}` : "web",
      unit: false,
      web: shard ?? true,
      desktop: false,
    };
  throw new Error(`--part must be unit, web or desktop, not ${part}`);
}

async function runE2ESuites(
  root: string,
  raw: string,
  snapshot: (directory: string) => void,
  which: Pick<CoveragePart, "web" | "desktop">,
): Promise<boolean> {
  let failed = false;
  const ports = await sandboxPorts();
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...ports, APX_TEST_COVERAGE: "1", APX_TEST_COVERAGE_DIR: raw, NODE_V8_COVERAGE: raw },
      timeout: 15 * 60_000,
    });
    if (result.status !== 0) {
      failed = true;
      if (result.error) console.error(result.error.message);
    }
  };
  run(pnpm, ["build:web"]);
  snapshot(path.join(root, "apps/web/dist"));
  snapshot(path.join(root, "packages/ui/dist"));
  if (which.web) {
    const shard = typeof which.web === "string" ? [`--shard=${which.web}`] : [];
    run(pnpm, ["exec", "playwright", "test", "--project", "chromium", ...shard]);
  }
  if (!which.desktop) return failed;
  run(pnpm, ["--filter", "@apx/desktop", "build"]);
  snapshot(path.join(root, "apps/desktop/dist"));
  const desktop = ["exec", "playwright", "test", "--project", "desktop"];
  if (process.platform === "linux" && !process.env.DISPLAY) {
    // Xvfb supplies a display; a window manager supplies real focus and minimization transitions.
    const launch =
      'command -v openbox >/dev/null || { echo "Install openbox for desktop window tests" >&2; exit 1; }; openbox >/dev/null 2>&1 & exec "$@"';
    run("xvfb-run", ["-a", "sh", "-c", launch, "apx-desktop", pnpm, ...desktop]);
  } else if (process.platform === "darwin") {
    // Native focus assertions need an awake display for the lifetime of the test process.
    run("caffeinate", ["-d", "-i", pnpm, ...desktop]);
  } else run(pnpm, desktop);
  return failed;
}

/** The unit suites, area by area, then the mobile app's own; their coverage lands in `raw` and `nativeOutput`. */
function runUnitSuites(root: string, raw: string, nativeOutput: string, snapshot: (directory: string) => void) {
  let failed = false;
  const allTests = testFiles(root).filter(
    (file) =>
      file.includes(".test.") &&
      !file.startsWith(path.join(root, "e2e")) &&
      !file.startsWith(path.join(root, "apps/mobile/test")),
  );
  const groups = new Map<string, string[]>();
  for (const file of allTests) {
    const relative = path.relative(root, file);
    const area = relative.startsWith("scripts/") ? "scripts" : relative.split(path.sep).slice(0, 2).join(path.sep);
    const group = groups.get(area) ?? [];
    group.push(relative);
    groups.set(area, group);
  }
  // UI tests consume the public build, including JSX and the design-system export boundary.
  const build = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: path.join(root, "packages/ui"),
    stdio: "inherit",
  });
  if (build.status !== 0) failed = true;
  snapshot(path.join(root, "packages/ui/dist"));
  for (const [area, files] of groups) {
    console.log(`\nCoverage: ${area} (${files.length} files)`);
    const cwd = area === "scripts" ? root : path.join(root, area);
    const run = spawnSync(
      process.execPath,
      ["--test", ...files.map((file) => path.relative(cwd, path.join(root, file)))],
      {
        cwd,
        env: { ...process.env, NODE_V8_COVERAGE: raw, APX_UI_TEST_COVERAGE_DIR: raw },
        stdio: "inherit",
        timeout: 10 * 60_000,
      },
    );
    if (run.status !== 0) {
      failed = true;
      if (run.error) console.error(run.error.message);
    }
  }
  const mobile = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "test:ui", "--", "--coverage", "--coverageDirectory", nativeOutput],
    {
      cwd: path.join(root, "apps/mobile"),
      env: { ...process.env, NODE_V8_COVERAGE: undefined },
      stdio: "inherit",
      shell: process.platform === "win32",
      timeout: 5 * 60_000,
    },
  );
  if (mobile.status !== 0) {
    failed = true;
    if (mobile.error) console.error(mobile.error.message);
  }
  return failed;
}

type PartStatus = { failed: boolean; suites: string[] };

/** The part folders under `dir` (CI downloads each part's artifact into a folder of its own). */
function partDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.existsSync(path.join(dir, "status.json"))) return [dir];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => partDirs(path.join(dir, e.name)));
}

/**
 * `--expect-parts=N`: a part whose job never uploaded (cancelled, out of time) leaves no folder at all, so the merge
 * must know how many to expect; fewer is a failure, not a smaller report.
 */
export function missingParts(found: number, argv: readonly string[]): string | undefined {
  const expected = Number(argv.find((a) => a.startsWith("--expect-parts="))?.slice("--expect-parts=".length));
  if (!expected || found >= expected) return undefined;
  return `Coverage merge: ${found} of ${expected} parts reported; the missing ones never uploaded their report.`;
}

/**
 * Several runs' reports of the same sources as one: a function ran if it ran in any of them. Each CI part reports on
 * its own machine, so only these small reports travel, never the raw V8 data.
 */
export function mergeCoverage(reports: FileCoverage[][]): FileCoverage[] {
  const byFile = new Map<string, FileCoverage>();
  for (const report of reports)
    for (const file of report) {
      const seen = byFile.get(file.file);
      if (!seen) {
        byFile.set(file.file, { ...file, functions: file.functions.map((f) => ({ ...f })) });
        continue;
      }
      seen.loaded ||= file.loaded;
      const ran = new Set(file.functions.filter((f) => f.covered).map((f) => `${f.line}:${f.name}`));
      for (const f of seen.functions) if (ran.has(`${f.line}:${f.name}`)) f.covered = true;
    }
  return [...byFile.values()];
}

/** Writes functions.json and functions.md; true when the run failed (or, with --strict, left functions unrun). */
function writeFunctions(root: string, output: string, report: FileCoverage[], status: PartStatus): boolean {
  fs.writeFileSync(
    path.join(output, "functions.json"),
    `${JSON.stringify({ testsPassed: !status.failed, suites: status.suites, files: report }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(output, "functions.md"), coverageMarkdown(report));
  const missing = report.flatMap((r) => r.functions.filter((f) => !f.covered));
  console.log(
    `\nFunction coverage: ${missing.length} unexecuted functions. Report: ${path.relative(root, output)}/functions.md`,
  );
  return status.failed || (process.argv.includes("--strict") && missing.length > 0);
}

/** The report of one run (its v8/, source-maps.json and mobile/ in `dir`), written beside them. */
function writeReport(root: string, dir: string, status: PartStatus): boolean {
  let failed = status.failed;
  const sourceMaps = new Map<string, CoverageSourceMap>();
  const scripts: V8Script[] = [];
  const instrumented: InstrumentedCoverage[] = [];
  {
    const saved = path.join(dir, "source-maps.json");
    if (fs.existsSync(saved))
      for (const map of JSON.parse(fs.readFileSync(saved, "utf8")) as CoverageSourceMap[]) sourceMaps.set(map.url, map);
    const payloads = readCoveragePayloads(path.join(dir, "v8"));
    for (const script of payloads.scripts) scripts.push(script);
    for (const map of payloads.sourceMaps) sourceMaps.set(map.url, map);
    const mobileReport = path.join(dir, "mobile", "coverage-final.json");
    if (fs.existsSync(mobileReport))
      for (const file of Object.values(JSON.parse(fs.readFileSync(mobileReport, "utf8"))) as InstrumentedCoverage[])
        instrumented.push(file);
  }
  const savedMaps = [...sourceMaps.values()];
  fs.writeFileSync(path.join(dir, "source-maps.json"), JSON.stringify(savedMaps));
  const missingMaps = missingSourceMaps(
    root,
    scripts.map((script) => script.url),
    savedMaps,
  );
  if (missingMaps.length) {
    failed = true;
    console.error(`Coverage source maps missing: ${missingMaps.join(", ")}`);
  }
  const files = sourceFiles(root).map((file) => ({
    file: path.relative(root, file).split(path.sep).join("/"),
    text: fs.readFileSync(file, "utf8"),
  }));
  const report = coverageReport(root, files, scripts, savedMaps, instrumented);
  return writeFunctions(root, dir, report, { ...status, failed });
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const includeE2E = process.argv.includes("--e2e");
  const all = path.join(root, "coverage", includeE2E ? "all" : "unit");
  // CI's last step: the reports of the parts that ran on other machines, as one.
  if (process.argv.includes("--merge")) {
    const dirs = partDirs(path.join(all, "parts"));
    if (!dirs.length) throw new Error(`no coverage parts under ${path.relative(root, all)}/parts`);
    const short = missingParts(dirs.length, process.argv);
    if (short) console.error(short);
    const read = <T>(dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as T;
    const statuses = dirs.map((d) => read<PartStatus>(d, "status.json"));
    const reports = dirs
      .filter((d) => fs.existsSync(path.join(d, "functions.json")))
      .map((d) => read<{ files: FileCoverage[] }>(d, "functions.json").files);
    const failed = statuses.some((s) => s.failed) || reports.length < dirs.length || Boolean(short);
    const suites = [...new Set(statuses.flatMap((s) => s.suites))].sort();
    if (writeFunctions(root, all, mergeCoverage(reports), { failed, suites })) process.exitCode = 1;
    return;
  }
  const part = coveragePart(process.argv);
  const output = part.name ? path.join(all, "parts", part.name) : all;
  const raw = path.join(output, "v8");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(raw, { recursive: true });
  if (part.unit) {
    const quality = checkTests(root);
    if (quality.length) {
      for (const finding of quality) console.error(`${finding.file}:${finding.line}: ${finding.reason}`);
      process.exitCode = 1;
      return;
    }
  }
  const sourceMaps = new Map<string, CoverageSourceMap>();
  const snapshot = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const map of snapshotSourceMaps(directory)) sourceMaps.set(map.url, map);
    fs.writeFileSync(path.join(output, "source-maps.json"), JSON.stringify([...sourceMaps.values()]));
  };
  let failed = false;
  if (part.unit) failed = runUnitSuites(root, raw, path.join(output, "mobile"), snapshot) || failed;
  if (part.web || part.desktop) failed = (await runE2ESuites(root, raw, snapshot, part)) || failed;
  const status = {
    failed,
    suites: [...(part.unit ? ["unit"] : []), ...(part.web ? ["web"] : []), ...(part.desktop ? ["desktop"] : [])],
  };
  const reportFailed = writeReport(root, output, status);
  // What --merge reads: written last, so a run that stopped before its report has none and counts as failed.
  fs.writeFileSync(path.join(output, "status.json"), JSON.stringify({ ...status, failed: reportFailed }));
  if (reportFailed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
