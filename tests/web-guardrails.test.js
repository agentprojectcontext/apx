// Rule 11, made mechanical.
//
// The web panel is its own pnpm workspace, and eslint.config.js ignores it
// wholesale ("own pnpm workspace with its own strict tsc gate"). That gate is
// a TYPE checker, not a linter: ~47k lines of TS/TSX are typed and nothing
// else. So the three invariants rule 11 states as prose — Base UI only, every
// request through lib/api, every string in both dictionaries — were held by
// discipline alone. All three were green when this file landed; the point is
// that they stay green without anyone remembering to look.
//
// Asserting on the front end from the backend suite is the established pattern
// here (chat-turn-shape, web-composer, web-chat-dock and a dozen more read the
// same sources), and it costs no new dependency: esbuild is already a devDep,
// and this suite already runs in preflight, pre-push and CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WEB = path.join(__dirname, "..", "src", "interfaces", "web");
const WEB_SRC = path.join(WEB, "src");

/** Every .ts/.tsx under the panel's src/, as [repo-relative path, source]. */
function webSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(full);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push([path.relative(WEB_SRC, full), fs.readFileSync(full, "utf8")]);
      }
    }
  })(WEB_SRC);
  return out;
}

/** Load a locale dictionary by transpiling it — the files are plain object
 *  literals, so this reads the REAL keys rather than regexing 2.5k lines. */
function loadDict(file, exportName) {
  const built = buildSync({
    entryPoints: [path.join(WEB_SRC, "i18n", file)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
  const dict = mod.exports[exportName];
  assert.ok(dict && typeof dict === "object", `${file} must export \`${exportName}\``);
  return dict;
}

/** Dotted paths of every leaf string, so a whole missing group is one diff. */
function leafKeys(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leafKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

test("i18n: every key exists in both dictionaries (rule 11)", () => {
  // Why this cannot be left to tsc. `t()` is typed as DeepKeys<EsStrings> — so
  // TypeScript checks call sites against es.ts and NOTHING checks en.ts, which
  // enters the dictionary map as `unknown`. Worse, lookupWithFallback() falls
  // back to the Spanish dict when the active locale lacks the key, so a key
  // missing from en.ts is not a crash and not a dev warning (that fires only
  // when BOTH lack it) — it is an English-speaking user silently reading
  // Spanish. Nothing in the build, the type check or the browser reports it.
  const en = loadDict("en.ts", "en");
  const es = loadDict("es.ts", "es");
  const EN = leafKeys(en);
  const ES = leafKeys(es);

  const missingInEs = [...EN].filter((k) => !ES.has(k)).sort();
  const missingInEn = [...ES].filter((k) => !EN.has(k)).sort();
  const show = (list) => list.slice(0, 20).join(", ") + (list.length > 20 ? `, …(+${list.length - 20})` : "");

  assert.deepEqual(missingInEn, [], `keys in es.ts with no en.ts entry — these read as Spanish for an English user: ${show(missingInEn)}`);
  assert.deepEqual(missingInEs, [], `keys in en.ts with no es.ts entry: ${show(missingInEs)}`);
  // A dictionary that loaded as an empty object would pass the two checks
  // above trivially, so pin the order of magnitude too.
  assert.ok(EN.size > 2000, `expected the full dictionary, got ${EN.size} keys`);
});

test("web: the panel is Base UI, never Radix or a shadcn install (rule 11)", () => {
  // The decision is spec/decisions/005-no-radix-on-web-panel.md. It survives
  // as long as nobody runs `npx shadcn add`, which would write components.json
  // and pull the whole Radix tree in behind it as a transitive dep.
  const pkg = JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const radix = Object.keys(deps).filter((d) => d.startsWith("@radix-ui/"));
  assert.deepEqual(radix, [], `Radix packages in the web panel: ${radix.join(", ")}`);

  assert.ok(
    !fs.existsSync(path.join(WEB, "components.json")),
    "components.json is back — that is the shadcn installer's config, and rule 11 keeps it deleted",
  );

  const offenders = webSources()
    .filter(([, src]) => /from\s+["']@radix-ui\//.test(src))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, [], `files importing Radix directly: ${offenders.join(", ")}`);
});

test("web: requests go through lib/api, not a bare fetch (rule 11)", () => {
  // Every call needs the daemon's base URL and the bearer token that
  // useTokenBootstrap fetches from /api/admin/web-token. A component calling
  // fetch() directly gets neither: it works on localhost with auth off and
  // 401s the moment the panel is reached over Tailscale.
  //
  // These three ARE the plumbing, so they are where raw fetch belongs:
  const ALLOWED = new Set([
    "lib/http.ts", // the get/post helper every lib/api module is built on
    "lib/net.ts", // probes candidate daemon origins before a base URL exists
    "hooks/useTokenBootstrap.ts", // fetches the token itself — cannot use it yet
  ]);

  const offenders = webSources()
    .filter(([rel]) => !rel.startsWith("lib/api/") && !ALLOWED.has(rel))
    // `fetch(` preceded by a word character is someone else's method
    // (`api.fetch(`, `queryClient.fetchX`) — only the global call counts.
    .filter(([, src]) => /(^|[^\w.])fetch\s*\(/m.test(src))
    .map(([rel]) => rel);

  assert.deepEqual(
    offenders,
    [],
    `bare fetch() outside lib/api — route these through src/lib/api/*: ${offenders.join(", ")}`,
  );
});
