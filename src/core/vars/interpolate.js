// ${var.NAME} interpolation engine.
//
// Used at MCP boot (and any other site that opts in) so files committed to
// the repo can hold references like
//   "Authorization": "Bearer ${var.ASANA_TOKEN}"
// while the real value lives in ~/.apx/vars.json or
// <storagePath>/vars.json (see ./sources.js).
//
// Semantics:
//   - Only top-level strings inside the input object/array are walked
//     recursively. Numbers/booleans/null pass through.
//   - A `${var.NAME}` token where NAME is missing throws a MissingVarError
//     listing every missing name (so the UI can show a single useful message
//     instead of "first failure wins").
//   - Names match [A-Z0-9_] / [a-z0-9_] / dot — we don't enforce a charset
//     beyond "no whitespace and no closing brace". Stay liberal here, strict
//     at the UI.

const VAR_RE = /\$\{var\.([^}\s]+)\}/g;

export class MissingVarError extends Error {
  constructor(missing) {
    super(
      `Undefined variable${missing.length > 1 ? "s" : ""}: ${missing
        .map((n) => `\${var.${n}}`)
        .join(", ")}`
    );
    this.name = "MissingVarError";
    this.missing = missing;
  }
}

// Collect every `${var.NAME}` reference found in `value` (deep walk).
// Returns an array of unique names in encounter order.
export function findRefs(value) {
  const seen = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      let m;
      VAR_RE.lastIndex = 0;
      while ((m = VAR_RE.exec(v)) !== null) seen.add(m[1]);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(value);
  return Array.from(seen);
}

// Replace every `${var.NAME}` inside `value` using the `vars` lookup. Missing
// names accumulate and surface as a single MissingVarError at the end so
// callers can show "missing: TOKEN_A, TOKEN_B" in one shot.
export function interpolate(value, vars) {
  const missing = new Set();

  const replaceString = (s) => {
    return s.replace(VAR_RE, (_, name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        return String(vars[name]);
      }
      missing.add(name);
      return _;
    });
  };

  const walk = (v) => {
    if (typeof v === "string") return replaceString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };

  const result = walk(value);
  if (missing.size) throw new MissingVarError(Array.from(missing));
  return result;
}
