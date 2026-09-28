// The super-agent's settings as the owner edits them: every knob the web panel
// shows, resolved to the value that is actually in effect.
//
// The guards and step budgets live under `super_agent.*` for history, but they
// are the shared loop's: run-agent, run-turn and every engine call read them,
// so they bind project agents and routines too. The panel says so.
//
// The panel saves back EVERYTHING it read on each "Save". A key left out of
// this view reads as "" or false and gets written back that way — which is how
// changing the avatar once wiped `self_model`. So a knob the panel edits must
// come from here, and it comes through the same resolver the loop uses, so the
// screen never shows a default the runtime does not apply.
import { PERMISSION_MODES } from "../constants/permissions.js";
import { judgeConfig } from "./judge.js";
import { stuckDetectionConfig } from "./stuck-detector.js";
import { securityRiskConfig } from "./security.js";
import { spendLimits, SPEND_DEFAULTS } from "./spend-breaker.js";
import { TELEGRAM_TOOL_ITERS, WEB_TOOL_ITERS, ROUTINE_UNCAPPED_TOOL_ITERS } from "./constants.js";

// 0 = "use the built-in default"; the panel shows the default as placeholder.
const budget = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

export function superAgentSettings(config = {}) {
  const sa = config.super_agent || {};
  const judge = judgeConfig(config);
  return {
    enabled: !!sa.enabled,
    model: sa.model || "",
    self_model: sa.self_model || "",
    self_model_fallback: sa.self_model_fallback !== false,
    system: sa.system || "",
    permission_mode: sa.permission_mode || PERMISSION_MODES.PERMISO,
    allowed_tools: sa.allowed_tools || [],
    model_fallback: sa.model_fallback || { enabled: false, models: [], order: [] },
    security_risk: securityRiskConfig(config),
    stuck_detection: stuckDetectionConfig(config),
    judge: { enabled: judge.enabled, continue_unfinished: judge.continue_unfinished },
    spend_breaker: spendLimits(config),
    telegram_max_iters: budget(sa.telegram_max_iters),
    web_max_iters: budget(sa.web_max_iters),
    routine_max_iters: budget(sa.routine_max_iters),
    defaults: {
      telegram_max_iters: TELEGRAM_TOOL_ITERS,
      web_max_iters: WEB_TOOL_ITERS,
      routine_max_iters: ROUTINE_UNCAPPED_TOOL_ITERS,
      spend_breaker: { ...SPEND_DEFAULTS },
    },
  };
}
