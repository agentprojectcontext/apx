import { z } from "zod";
import type { MethodDef } from "./methods.ts";

export const EngineUsageWindow = z.object({
  id: z.enum(["primary", "secondary"]),
  used_percent: z.number().min(0).max(100),
  window_minutes: z.number().int().positive().optional(),
  resets_at: z.iso.datetime().optional(),
});
export const EngineUsage = z.object({
  id: z.string(),
  label: z.string(),
  cli_installed: z.boolean(),
  available: z.boolean(),
  status: z.enum(["ok", "unavailable"]),
  source: z.enum(["codex_app_server", "claude_cli", "none"]),
  windows: z.array(EngineUsageWindow),
  reason: z.enum(["unsupported", "cli_not_found", "not_available"]).optional(),
});
export const EngineUsageReport = z.object({
  checked_at: z.iso.datetime(),
  engines: z.array(EngineUsage),
});
export type EngineUsageReport = z.infer<typeof EngineUsageReport>;
export type EngineUsageWindow = z.infer<typeof EngineUsageWindow>;
export const EngineUsagePreferences = z.object({ engines: z.record(z.string(), z.boolean()) });
export const engineUsageMethods = {
  "engines.usage_preferences": {
    params: z.object({}).strict(),
    result: EngineUsagePreferences,
    effect: false,
    access: "human",
  },
  "engines.set_usage": {
    params: z.object({ engine: z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,63}$/), enabled: z.boolean() }).strict(),
    result: EngineUsagePreferences,
    effect: true,
    access: "human",
  },
  "engines.usage": {
    params: z.object({}).strict(),
    result: EngineUsageReport,
    effect: false,
    access: "human",
  },
} as const satisfies Record<string, MethodDef>;
