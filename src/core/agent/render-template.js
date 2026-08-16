// The one prompt-template renderer. Lives on its own so modules that build
// prompt blocks (core/personas/, channel blocks, …) can use it without
// importing prompt-builder.js, which imports them back.
//
// Deliberately minimal: `{{name}}` only, `\w+` only. A missing, null or empty
// value renders as an empty string — it does NOT fall back to anything. Callers
// that need a sensible default must resolve it before calling.
export function renderPromptTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null || value === "" ? "" : String(value);
  });
}

/**
 * Any `{{…}}` the renderer could not handle — dotted paths, typos, whitespace.
 * Those survive renderPromptTemplate untouched and would reach the model as
 * literal braces, so callers building user-authored templates should check.
 */
export function findOrphanVars(text) {
  return [...String(text || "").matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
}
