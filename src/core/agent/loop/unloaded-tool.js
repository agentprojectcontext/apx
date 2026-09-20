// Calling a tool whose schema was never sent.
//
// Lazy tools put the NAMES of not-loaded tools in the system prompt — that is
// what makes them discoverable — so the model can name a real tool before it
// has ever seen its parameters. The loop's answer was to activate the tool and
// hand back its schema with "nothing ran", which is correct and costs one
// iteration.
//
// One iteration is the cheap part. The expensive part is what the model does
// with the round trip: on 2026-09-20 `call_runtime` bounced this way four times
// out of nine, and each time the retry came back byte-identical — straight into
// the side-effect ledger's dedup, which answered `{ok: true, deduped: true}`
// because the FIRST call had been recorded even though it had explicitly not
// run. The agent read `ok: true` and told the owner it had launched sessions
// that did not exist.
//
// So: when the arguments the model already passed satisfy the schema it was
// missing, there is nothing to re-ask. Activate and run. The bounce stays for
// the case it was written for — a model that guessed the name AND the arguments
// (`complete_task` called as `{project, id}` when the schema says `task`) — and
// there the schema is genuinely new information.
//
// Safety note: this does not widen anything. `session.activate` applies the
// role gate and refuses a tool the caller may not have, and a `dangerous` tool
// still goes through `requirePermission` inside its own handler, exactly as it
// would have on the second call.

/** The `{type: "object", properties, required}` block, wherever it lives. */
function parametersOf(schema) {
  const fn = schema?.function || schema;
  return fn?.parameters || null;
}

/** Does this value match the JSON-Schema primitive type a property declares? */
function typeMatches(declared, value) {
  switch (declared) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    case "object": return !!value && typeof value === "object" && !Array.isArray(value);
    // A type we don't model (null, a union, an absent `type`) is not a reason to
    // refuse: the handler validates too, and guessing here would bounce calls
    // that are fine.
    default: return true;
  }
}

/**
 * Can the call run as-is against the schema it never received?
 *
 * Deliberately narrow — required fields present, declared enums respected,
 * primitive types right. It is NOT a validator: the handler remains the
 * authority on its own arguments, and anything this misses reaches it exactly
 * as it would from a model that HAD the schema.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function argsSatisfySchema(schema, args) {
  const params = parametersOf(schema);
  // No schema to check against: fall back to the bounce rather than running a
  // call nothing has vouched for.
  if (!params || typeof params !== "object") return { ok: false, reason: "no parameter schema" };

  const properties = params.properties && typeof params.properties === "object" ? params.properties : {};
  const given = args && typeof args === "object" && !Array.isArray(args) ? args : {};

  const missing = (Array.isArray(params.required) ? params.required : [])
    .filter((k) => given[k] === undefined || given[k] === null || given[k] === "");
  if (missing.length) return { ok: false, reason: `missing required: ${missing.join(", ")}` };

  for (const [key, value] of Object.entries(given)) {
    const prop = properties[key];
    // An argument the schema does not mention. The model invented it, which is
    // the signal this whole path exists to catch — it saw no schema, so it
    // guessed the shape.
    if (!prop) return { ok: false, reason: `unknown argument: ${key}` };
    if (value === undefined || value === null) continue;
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      return { ok: false, reason: `${key} is not one of ${prop.enum.join(" | ")}` };
    }
    if (prop.type && !typeMatches(prop.type, value)) {
      return { ok: false, reason: `${key} should be ${prop.type}` };
    }
  }
  return { ok: true };
}
