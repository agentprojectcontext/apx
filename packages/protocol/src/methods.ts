// Method registry: the single source of truth for what the core answers.
// Adding a method = one entry here + one handler in apps/core/src/rpc. Every client gets the types for free.
import { z } from "zod";
import { appMethods } from "./app-methods.ts";
import { artifactMethods } from "./artifact-methods.ts";
import { asanaMethods } from "./asana-methods.ts";
import { browserMethods } from "./browser.ts";
import { desktopInstallMethods } from "./desktop-install.ts";
import { deviceMethods } from "./device-methods.ts";
import { environmentMethods } from "./environment-methods.ts";
import { telemetryMethods } from "./telemetry-methods.ts";
import { terminalMethods } from "./terminal-methods.ts";
import { threadMethods } from "./thread-methods.ts";
import { usageMethods } from "./usage-methods.ts";

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
  /** What the core process takes in memory (resident), in MB. */
  rss_mb: z.number().optional(),
  subsystems: z.record(z.string(), SubsystemStatus),
  /** The panel build the core serves now (its entry file): a panel showing another one is out of date. */
  panel: z.string().optional(),
});
export type Health = z.infer<typeof Health>;

export const LogLine = z.object({
  t: z.string().optional(),
  level: z.enum(["info", "warn", "error"]),
  /** Who wrote it: the core's logger, or "output" for anything else the process printed (a crash's trace). */
  scope: z.string(),
  msg: z.string(),
  /** The line's other fields, as JSON. */
  detail: z.string().optional(),
});
export type LogLine = z.infer<typeof LogLine>;

export type MethodDef = {
  params: z.ZodType;
  result: z.ZodType;
  /** true → the call must carry an idempotency key. */
  effect: boolean;
  /** "human" → only a human operator may call it (never an agent, a tool or an agent client). Default: anyone. */
  access?: "human";
  /** false → its result is never kept for a retried request (it holds something shown once, like a token). */
  replay?: false;
  /** true → callable without the core's token (still from an allowed origin): pairing a device, whose code is the key. */
  open?: true;
  /** Only direct loopback requests may control installation on the core's computer. */
  local?: true;
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
  /** The newest lines of the core's log (<home>/logs/core.log) that match, oldest first; `more`: older ones match too. */
  "system.logs": {
    params: z
      .object({
        limit: z.number().int().min(1).max(1000).default(300),
        level: z.enum(["info", "warn", "error"]).optional(),
        scope: z.string().max(80).optional(),
        q: z.string().max(200).optional(),
      })
      .strict(),
    result: z.object({
      path: z.string(),
      exists: z.boolean(),
      lines: z.array(LogLine),
      scopes: z.array(z.string()),
      more: z.boolean(),
    }),
    effect: false,
    access: "human",
  },
  ...browserMethods,
  ...appMethods,
  ...artifactMethods,
  ...asanaMethods,
  ...deviceMethods,
  ...environmentMethods,
  ...desktopInstallMethods,
  ...threadMethods,
  ...terminalMethods,
  ...telemetryMethods,
  ...usageMethods,
} as const satisfies Record<string, MethodDef>;

export type MethodName = keyof typeof methods;
export type Params<M extends MethodName> = z.input<(typeof methods)[M]["params"]>;
/** Params after validation (defaults applied): what handlers receive. */
export type ParsedParams<M extends MethodName> = z.output<(typeof methods)[M]["params"]>;
export type Result<M extends MethodName> = z.output<(typeof methods)[M]["result"]>;

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methods, name);
}

/** The methods an outside app may call, by scope; anything else is refused to it. */
export const SCOPE_METHODS: Record<"chat" | "browser", readonly MethodName[]> = {
  chat: ["agents.list", "threads.create", "threads.get", "threads.send"],
  browser: (Object.keys(browserMethods) as MethodName[]).filter((m) => methodAccess(m) !== "human"),
};

/** Whether a method may be called without the core's token (see MethodDef.open). */
export function methodOpen(name: string): boolean {
  return isMethodName(name) && (methods[name] as MethodDef).open === true;
}

export function methodAccess(name: MethodName): "any" | "human" {
  return (methods[name] as MethodDef).access ?? "any";
}
