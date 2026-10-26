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
  source: z.enum(["codex_app_server", "none"]),
  windows: z.array(EngineUsageWindow),
  reason: z.enum(["unsupported", "cli_not_found", "not_available"]).optional(),
});
export const EngineUsageReport = z.object({
  checked_at: z.iso.datetime(),
  engines: z.array(EngineUsage),
});
export type EngineUsageReport = z.infer<typeof EngineUsageReport>;
export type EngineUsageWindow = z.infer<typeof EngineUsageWindow>;
export const engineUsageMethods = {
  "engines.usage": {
    params: z.object({}).strict(),
    result: EngineUsageReport,
    effect: false,
    access: "human",
  },
} as const satisfies Record<string, MethodDef>;
