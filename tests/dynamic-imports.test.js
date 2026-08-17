// Dynamic imports are invisible to every gate we have: ESLint does not resolve
// them, and a tool nobody tests never executes the line.
//
// core/http-tools/registry.js's `memory_list` handler imported "../parser.js"
// and "../agent-memory.js" — neither exists (they are ../apc/parser.js and
// ../agent/memory.js). The tool threw on every single call, and stayed broken
// because nothing here looked.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist"].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(abs));
    else if (e.name.endsWith(".js")) out.push(abs);
  }
  return out;
}

test("every relative dynamic import resolves to a file that exists", () => {
  const broken = [];
  for (const file of jsFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) {
        broken.push(`${path.relative(REPO, file)} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(broken, [], "dynamic imports the linter cannot see");
});

test("every relative static import resolves too", () => {
  const broken = [];
  for (const file of jsFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)[^\n]*?\bfrom\s+["'](\.[^"']+)["']/gm)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) {
        broken.push(`${path.relative(REPO, file)} -> ${m[1]}`);
      }
    }
  }
  assert.deepEqual(broken, [], "unresolvable relative import");
});

// The #core/#host/#interfaces aliases are declared in package.json `imports`
// and mirrored in jsconfig.json. A typo resolves to nothing at runtime.
test("every #alias import resolves through package.json imports", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const aliases = Object.entries(pkg.imports || {}).map(([k, v]) => [
    k.replace("/*", ""),
    String(v).replace("/*", "").replace("./", ""),
  ]);
  assert.ok(aliases.length >= 3, "expected #core/#host/#interfaces");

  const broken = [];
  for (const file of jsFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)[^\n]*?["'](#[^"']+)["']|import\(\s*["'](#[^"']+)["']\s*\)/gm)) {
      const spec = m[1] || m[2];
      if (!spec) continue;
      const hit = aliases.find(([prefix]) => spec.startsWith(prefix + "/"));
      if (!hit) {
        broken.push(`${path.relative(REPO, file)} -> ${spec} (unknown alias)`);
        continue;
      }
      const rel = spec.slice(hit[0].length + 1);
      if (!fs.existsSync(path.join(REPO, hit[1], rel))) {
        broken.push(`${path.relative(REPO, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], "alias import points at a missing file");
});

// package.json declares four bins. `apx-mcp` could not load at all: its import
// of "../../cli/http.js" resolved to src/cli/http.js (a directory level too
// high) and `zod` was imported but never declared as a dependency. A shipped
// binary was dead and nothing noticed, because no test ever loaded one.
test("every declared bin resolves all of its imports", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const bins = Object.entries(pkg.bin || {});
  assert.ok(bins.length >= 4, `expected 4 bins, got ${bins.length}`);

  const broken = [];
  for (const [name, rel] of bins) {
    const entry = path.join(REPO, rel);
    if (!fs.existsSync(entry)) {
      broken.push(`${name}: entry ${rel} is missing`);
      continue;
    }
    const src = fs.readFileSync(entry, "utf8");
    const specs = [...src.matchAll(/^\s*import[^\n]*?from\s+["']([^"']+)["']/gm)].map(
      (m) => m[1]
    );
    const base = new URL(`file://${entry}`).href;
    for (const spec of specs) {
      try {
        await import.meta.resolve(spec, base);
      } catch {
        broken.push(`${name}: cannot resolve ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], "a shipped bin cannot start");
});
