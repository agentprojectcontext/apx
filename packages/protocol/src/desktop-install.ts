import { z } from "zod";
import type { MethodDef } from "./methods.ts";

export const DesktopInstallStatus = z.object({
  available: z.boolean(),
  installed: z.boolean(),
  phase: z.enum(["idle", "downloading", "installing", "opening", "ready", "failed"]),
  received: z.number().nonnegative(),
  total: z.number().positive().optional(),
  error: z.string().optional(),
});
export type DesktopInstallStatus = z.infer<typeof DesktopInstallStatus>;

export const desktopInstallMethods = {
  "desktop.install_status": {
    params: z.object({}).strict(),
    result: DesktopInstallStatus,
    effect: false,
    access: "human",
    local: true,
  },
  "desktop.install": {
    params: z.object({}).strict(),
    result: DesktopInstallStatus,
    effect: true,
    access: "human",
    local: true,
    replay: false,
  },
  "desktop.install_cancel": {
    params: z.object({}).strict(),
    result: DesktopInstallStatus,
    effect: true,
    access: "human",
    local: true,
    replay: false,
  },
} as const satisfies Record<string, MethodDef>;
