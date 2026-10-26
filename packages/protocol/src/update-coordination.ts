import { z } from "zod";

export const UpdateTarget = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .max(40);
export const UpdateCoordination = z.object({
  target: UpdateTarget,
  phase: z.enum(["prepared", "installing", "restarting", "complete", "failed"]),
  running: z.string(),
  deadline: z.string().optional(),
  error: z.string().max(2000).optional(),
});

export const updateCoordinationMethods = {
  /** A shared pinned release; only the core confirms completion after running that version. */
  "system.update_state": {
    params: z.object({}).strict(),
    result: z.object({
      coordination_protocol: z.literal(1),
      running: z.string(),
      coordination: UpdateCoordination.nullable(),
      supported: z.boolean(),
      error: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  /** Validates the server and requesting Desktop assets before recording a shared target. */
  "system.update_prepare": {
    params: z
      .object({
        target: UpdateTarget,
        desktop: z.object({ os: z.enum(["linux", "mac", "win"]), arch: z.enum(["x64", "arm64"]) }).strict(),
        format: z.literal("zip").optional(),
      })
      .strict(),
    result: UpdateCoordination,
    effect: true,
    access: "human",
  },
} as const;
