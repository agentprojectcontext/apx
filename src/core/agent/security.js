// Inline security-risk analysis (OpenHands LLMSecurityAnalyzer pattern).
//
// Instead of a second "is this safe?" LLM call, the model grades each of its
// OWN tool calls by filling a `security_risk` field injected into every tool
// schema. The agent loop extracts the field before execution and a
// confirmation policy decides whether the call pauses for human approval.
// Zero extra latency, zero extra tokens beyond the one enum argument.
//
// Risk semantics (ordered): LOW < MEDIUM < HIGH. UNKNOWN means the model
// omitted the field (weak models do) — the policy decides whether UNKNOWN
// pauses via `confirm_unknown`.

export const SECURITY_RISK_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH"]);
export const SECURITY_RISK_UNKNOWN = "UNKNOWN";

const RISK_ORDER = { LOW: 1, MEDIUM: 2, HIGH: 3 };

// Loop-control / interaction tools that never touch the world — grading them
// only burns tokens and trains the model to rubber-stamp the field.
const RISK_EXEMPT_TOOLS = new Set(["finish", "ask_questions", "discover_tools"]);

export function normalizeRisk(value) {
  const v = String(value || "").trim().toUpperCase();
  return RISK_ORDER[v] ? v : SECURITY_RISK_UNKNOWN;
}

export function securityRiskConfig(globalConfig) {
  const raw = globalConfig?.super_agent?.security_risk || {};
  return {
    enabled: raw.enabled === true,
    confirm_at: normalizeRisk(raw.confirm_at) === SECURITY_RISK_UNKNOWN ? "HIGH" : normalizeRisk(raw.confirm_at),
    confirm_unknown: raw.confirm_unknown !== false,
  };
}

export function isSecurityRiskEnabled(globalConfig) {
  return securityRiskConfig(globalConfig).enabled;
}

const SECURITY_RISK_PROPERTY = Object.freeze({
  type: "string",
  enum: [...SECURITY_RISK_LEVELS],
  description:
    "Your assessment of the safety risk of this action. LOW: read-only or " +
    "trivially reversible. MEDIUM: modifies local state but is reversible. " +
    "HIGH: destructive, outward-facing (messages someone, publishes, spends) " +
    "or hard to reverse.",
});

/**
 * Return a copy of `schemas` where every eligible tool gains a required
 * `security_risk` enum parameter. Originals are never mutated (schemas are
 * module-level constants shared across sessions). The field is listed first
 * so it stays visible to the model, mirroring OpenHands' field prioritization.
 */
export function withSecurityRiskField(schemas) {
  return (schemas || []).map((s) => {
    const fn = s?.function;
    const name = fn?.name || s?.name;
    if (!fn || !name || RISK_EXEMPT_TOOLS.has(name)) return s;
    const params = fn.parameters || { type: "object", properties: {} };
    if (params.properties?.security_risk) return s;
    return {
      ...s,
      function: {
        ...fn,
        parameters: {
          ...params,
          properties: { security_risk: SECURITY_RISK_PROPERTY, ...(params.properties || {}) },
          required: ["security_risk", ...(params.required || [])],
        },
      },
    };
  });
}

/**
 * Extract (and delete) `security_risk` from parsed tool args. Handlers never
 * see the field — it belongs to the loop, not the tool contract.
 */
export function popSecurityRisk(args) {
  if (!args || typeof args !== "object") return SECURITY_RISK_UNKNOWN;
  const risk = normalizeRisk(args.security_risk);
  delete args.security_risk;
  return risk;
}

/**
 * ConfirmRisky policy: pause when the model's own grade meets the configured
 * threshold (or when it didn't grade at all and confirm_unknown is on).
 */
export function shouldConfirmRisk(risk, cfg) {
  if (!cfg?.enabled) return false;
  const r = normalizeRisk(risk);
  if (r === SECURITY_RISK_UNKNOWN) return cfg.confirm_unknown !== false;
  return RISK_ORDER[r] >= RISK_ORDER[cfg.confirm_at || "HIGH"];
}
