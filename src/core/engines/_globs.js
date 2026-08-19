// Shell-style glob matching for model ids.
//
// Several adapters gate a wire-format quirk on WHICH model is answering rather
// than on which provider it came from: Gemini's thought signatures, DeepSeek's
// reasoning replay. Declaring those as glob patterns keeps "which models need
// this" a list an operator can read and a config key can override, instead of
// a branch buried in the serialiser.
//
// Patterns match the bare model id (no `<provider>:` prefix): `*` is any run of
// characters, `?` a single one. Matching is case-insensitive.

function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

/** Does `model` match any of `patterns`? An empty list matches nothing. */
export function matchesModelGlob(model, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const id = String(model || "");
  return patterns.some((p) => globToRegExp(p).test(id));
}

/**
 * Resolve "which models use this mechanism" from config, falling back to the
 * adapter's built-in list.
 *
 * A configured array REPLACES the default — it is the whole answer to the
 * question, so an install can also opt out entirely with an explicit `[]`.
 */
export function modelListFromConfig(configured, builtIn) {
  return Array.isArray(configured) ? configured : builtIn;
}
