// Method registry: the single source of truth for what the core answers.
// Adding a method = one entry here + one handler in apps/core/src/rpc. Every client gets the types for free.
import { z } from "zod";
import { browserMethods } from "./browser.ts";

export const SubsystemStatus = z.object({
  status: z.enum(["ok", "degraded", "down", "off"]),
  detail: z.string().optional(),
});

export const Health = z.object({
  name: z.literal("apx-core"),
  version: z.string(),
  /** Git sha of the running code: answers "is the daemon running my code?". */
  code_sha: z.string(),
  home_id: z.string(),
  protocol: z.number().int(),
  started_at: z.string(),
  uptime_s: z.number(),
  subsystems: z.record(z.string(), SubsystemStatus),
});
export type Health = z.infer<typeof Health>;

type MethodDef = {
  params: z.ZodType;
  result: z.ZodType;
  /** true → the call must carry an idempotency key. */
  effect: boolean;
};

export const methods = {
  "system.health": {
    params: z.object({}).strict(),
    result: Health,
    effect: false,
  },
  "system.ping": {
    params: z.object({ echo: z.string().max(200).optional() }).strict(),
    result: z.object({ pong: z.string(), at: z.string() }),
    effect: false,
  },
  ...browserMethods,
} as const satisfies Record<string, MethodDef>;

export type MethodName = keyof typeof methods;
export type Params<M extends MethodName> = z.input<(typeof methods)[M]["params"]>;
export type Result<M extends MethodName> = z.output<(typeof methods)[M]["result"]>;

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methods, name);
}
