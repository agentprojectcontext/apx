import { z } from "zod";
import { NEGATIVE_PROMPT_MAX } from "./constants.ts";
import { ServiceDialect, ServiceKind } from "./domain-accounts.ts";

/** Memory by meaning on this machine: Ollama here (or not), its embedding models, the one that fits, a pull going on. */
export const LocalEmbedding = z.object({
  memory_gb: z.number(),
  ollama: z.object({
    url: z.string(),
    running: z.boolean(),
    version: z.string().optional(),
    /** The embedding models it has pulled. */
    models: z.array(z.object({ name: z.string(), mb: z.number() })),
  }),
  /** Ollama's library models to pick from, with their download size. */
  library: z.array(z.object({ id: z.string(), mb: z.number(), quality: z.enum(["basic", "good", "great"]) })),
  recommended: z.string(),
  pull: z
    .object({ model: z.string(), completed: z.number(), total: z.number(), error: z.string().optional() })
    .optional(),
  /** The embedding engine in use now ("Ollama · bge-m3"). */
  active: z.string().optional(),
});
export type LocalEmbedding = z.infer<typeof LocalEmbedding>;
export const ImageDefaults = z.object({
  width: z.number().int().min(64).max(4096),
  height: z.number().int().min(64).max(4096),
  steps: z.number().int().min(1).max(200),
  cfg_scale: z.number().min(0).max(50),
  negative_prompt: z.string().max(NEGATIVE_PROMPT_MAX),
  count: z.number().int().min(1).max(8),
});
export type ImageDefaults = z.infer<typeof ImageDefaults>;
export const ServiceSettings = z.object({
  kind: ServiceKind,
  dialect: ServiceDialect,
  label: z.string().min(1).max(60),
  base_url: z.string().url(),
  enabled: z.boolean(),
  needs_key: z.boolean(),
  model: z.string().max(200).optional(),
  voice: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  style: z.string().max(300).optional(),
  /** QVox cloned voices: the reference recording (a path on the QVox machine), its words, and how loose to read. */
  clone: z.string().max(500).optional(),
  ref_text: z.string().max(2000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  /** Image services: this one's own defaults over the shared ones. */
  defaults: ImageDefaults.partial().optional(),
});
export type ServiceSettings = z.infer<typeof ServiceSettings>;
export const ServiceInfo = ServiceSettings.extend({
  id: z.string(),
  key_set: z.boolean(),
  /** Checked a moment ago: answers, does not answer, or not checked (switched off). */
  status: z.enum(["reachable", "unreachable", "unknown"]),
});
export type ServiceInfo = z.infer<typeof ServiceInfo>;
/**
 * A service asked now: it answers (with the models it offers, when it lists them), or why not: no answer in time,
 * nothing listening there, an unknown name, a refused key, another HTTP error.
 */
export const ServiceTest = z.object({
  ok: z.boolean(),
  problem: z.enum(["timeout", "refused", "name", "key", "http", "other"]).optional(),
  detail: z.string().optional(),
  models: z.array(z.string()).optional(),
});
export type ServiceTest = z.infer<typeof ServiceTest>;
