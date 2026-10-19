import { z } from "zod";

const Thread = z.object({ thread: z.string().min(1).max(100) }).strict();
const Appearance = Thread.extend({ appearance: z.enum(["light", "dark"]) }).strict();
export const environmentMethods = {
  "environments.status": {
    params: z.object({}).strict(),
    result: z.object({
      enabled: z.boolean(),
      ready: z.boolean(),
      control: z.enum(["agent", "human"]).optional(),
      changing: z.boolean().optional(),
      name: z.string(),
      thread: z.string().optional(),
      workspace: z.string(),
      model: z.string().optional(),
      demo: z.boolean().optional(),
      supported: z.boolean().optional(),
      phase: z
        .enum(["not_installed", "stopped", "preparing", "running", "stopping", "error", "unsupported"])
        .optional(),
      step: z.enum(["runtime", "guest", "desktop"]).optional(),
      downloaded: z.number().nonnegative().optional(),
      total: z.number().nonnegative().optional(),
      error: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
  "environments.enable": {
    params: Appearance,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.control": {
    params: Thread.extend({ mode: z.enum(["agent", "human"]) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.stop": {
    params: Thread,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.appearance": {
    params: Appearance,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    replay: false,
    access: "human",
  },
  "environments.bind": {
    params: Thread,
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "environments.display": {
    params: Thread,
    result: z.object({ ticket: z.string(), expires_in: z.number() }),
    effect: true,
    access: "human",
    replay: false,
  },
  "environments.command": {
    params: Thread.extend({ command: z.string().min(1).max(4000) }).strict(),
    result: z.object({ code: z.number().int(), output: z.string() }),
    effect: true,
    replay: false,
  },
} as const;
