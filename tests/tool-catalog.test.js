// The HTTP tool catalog points 33 of its 35 entries at daemon routes. Nothing
// checked that those routes exist, or that the proxy could reach them:
//
//   - /api/tools/:name/call never forwarded the caller's Authorization header,
//     so every endpoint-backed tool answered 401. Only the two inline handlers
//     worked. No test covered the proxy at all.
//   - search_files pointed at GET /api/files/search, a route that does not
//     exist (the real one is GET /api/files).
//
// Both are catalog-to-reality drift, which is precisely what a data file
// separated from its consumers invites. These tests close it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_DEFINITIONS } from "#core/http-tools/catalog.js";
import { API_PREFIX } from "#host/daemon/api/prefix.js";
import { buildApi } from "#host/daemon/api.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Ground truth: build the real app and walk its router stack. Parsing the
// source misses everything mounted as a sub-router (api.use("/tools/fetch",
// buildFetchRouter(...))), which is most of the tool surface.
function registeredRoutes() {
  const app = buildApi({
    projects: { list: () => [], get: () => null, rebuild() {} },
    registries: {},
    plugins: new Map(),
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally() {},
    config: {},
    token: "test-token",
  });
  const walk = (stack, prefix = "") => {
    const out = [];
    for (const layer of stack || []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          out.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const seg = (layer.regexp?.source || "")
          .replace("^\\/", "")
          .replace("\\/?(?=\\/|$)", "")
          .replace(/\\\//g, "/")
          .replace(/\$$/, "")
          .replace("(?=\\/|$)", "");
        const nested = seg && seg !== "(?:\\/(?=$))?" ? `/${seg}` : "";
        out.push(...walk(layer.handle.stack, prefix + nested));
      }
    }
    return out;
  };
  return walk(app._router?.stack || app.router?.stack);
}

// Compare ignoring param names: the catalog writes :pid, a route may write :id.
const shape = (s) => s.replace(/:[A-Za-z_]+/g, ":p").replace(/\/+$/, "");

test("every catalog endpoint points at a route the daemon registers", () => {
  const routes = [...registeredRoutes()].map(shape);
  const missing = [];
  for (const tool of TOOL_DEFINITIONS) {
    if (!tool.endpoint) continue;
    const want = shape(`${tool.endpoint.method || "GET"} ${tool.endpoint.path}`);
    if (!routes.includes(want)) {
      missing.push(`${tool.name} -> ${tool.endpoint.method} ${tool.endpoint.path}`);
    }
  }
  assert.deepEqual(missing, [], "catalog points at routes that do not exist");
});

test("every catalog endpoint path is under the /api mount", () => {
  const stray = TOOL_DEFINITIONS.filter(
    (t) => t.endpoint && !t.endpoint.path.startsWith(`${API_PREFIX}/`)
  ).map((t) => `${t.name} -> ${t.endpoint.path}`);
  assert.deepEqual(stray, [], "every data route lives under /api");
});

test("the call proxy forwards the caller's Authorization header", () => {
  const src = fs.readFileSync(
    path.join(REPO, "src/core/http-tools/registry.js"),
    "utf8"
  );
  const proxy = src.slice(src.indexOf('router.post("/:name/call"'));
  assert.match(
    proxy,
    /authorization/i,
    "without this every endpoint-backed tool answers 401"
  );
});

test("catalog entries are well-formed", () => {
  const problems = [];
  const seen = new Set();
  for (const t of TOOL_DEFINITIONS) {
    if (!t.name) problems.push("a tool has no name");
    if (seen.has(t.name)) problems.push(`duplicate tool name: ${t.name}`);
    seen.add(t.name);
    if (!t.description) problems.push(`${t.name}: no description`);
    if (!t.category) problems.push(`${t.name}: no category`);
    if (!t.parameters || t.parameters.type !== "object") {
      problems.push(`${t.name}: parameters must be a JSON-Schema object`);
    }
    for (const req of t.parameters?.required || []) {
      if (!t.parameters.properties?.[req]) {
        problems.push(`${t.name}: requires "${req}" but never declares it`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

// A tool whose path carries :slug but never requires the argument that fills it
// produces a URL with an empty segment (/agents//sessions) and a 404 the caller
// cannot diagnose.
test("path params are backed by a required parameter", () => {
  const FILLED_BY = { pid: "project", slug: "agent", sid: "session_id", id: "session_id", name: "name" };
  const problems = [];
  for (const t of TOOL_DEFINITIONS) {
    if (!t.endpoint) continue;
    for (const m of t.endpoint.path.matchAll(/:([A-Za-z_]+)/g)) {
      const arg = FILLED_BY[m[1]];
      if (!arg) continue;
      const required = t.parameters?.required || [];
      const known = t.parameters?.properties || {};
      // `project` legitimately defaults to 0; the rest must be supplied.
      if (arg === "project") continue;
      if (!required.includes(arg) && !known[arg]) {
        problems.push(`${t.name}: path has :${m[1]} but no "${arg}" parameter`);
      }
    }
  }
  assert.deepEqual(problems, [], "an unfilled path param yields //  in the URL");
});
