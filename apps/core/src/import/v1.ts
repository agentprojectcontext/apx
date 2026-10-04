// Read-only import from a local APX v1: registers the project folders it knows (each one's AGENTS.md and .apc/ are
// then read from disk, like any project) and, only when asked, copies its model API keys and its skills once into
// v2's own home. Never writes to v1; never sends the v1 token off this machine.
import fs from "node:fs";
import path from "node:path";
import { ImageDefaults, type ServiceSettings } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import type { Secrets } from "../secrets.ts";

type V1Project = { id: number; name: string; path: string; missing: boolean };

/** v1 config path → v2 secret name. */
const V1_KEYS: Record<string, string> = {
  "engines.gemini.api_key": "gemini",
  "engines.anthropic.api_key": "anthropic",
  "engines.openai.api_key": "openai",
};

function v1Value(config: unknown, dotted: string): string | undefined {
  let cur: unknown = config;
  for (const k of dotted.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return typeof cur === "string" && cur ? cur : undefined;
}

/** v1's model API keys into v2's secrets, once each (a name v2 already has stays); the names copied. */
export function importKeys(home: string, secrets: Secrets): string[] {
  const keys: string[] = [];
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")) as unknown;
    for (const [from, name] of Object.entries(V1_KEYS)) {
      const value = v1Value(config, from);
      if (value && !secrets.listed(name)) {
        secrets.set(name, value);
        keys.push(name);
      }
    }
  } catch {}
  return keys;
}

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Anything already at that name, a broken link included, is the owner's and stays. */
const taken = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Copies v1's skills into `to` once: a folder is copied without the links inside it; a skill that was itself a link
 * stays a link to the same place. A name v2 already has is left alone.
 */
export function importSkills(from: string, to: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(from);
  } catch {
    return [];
  }
  fs.mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of names.sort()) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (!SKILL_NAME.test(name) || taken(dst)) continue;
    try {
      if (!fs.existsSync(path.join(src, "SKILL.md"))) continue;
      if (fs.lstatSync(src).isSymbolicLink()) fs.symlinkSync(fs.realpathSync(src), dst);
      else
        fs.cpSync(src, dst, {
          recursive: true,
          filter: (f) => !fs.lstatSync(f).isSymbolicLink() && path.basename(f) !== ".DS_Store",
        });
      copied.push(name);
    } catch {
      fs.rmSync(dst, { recursive: true, force: true });
    }
  }
  return copied;
}

type V1Service = {
  label?: string;
  kind?: string;
  base_url?: string;
  enabled?: boolean;
  model?: string | null;
  voice?: string | null;
  language?: string | null;
  style?: string | null;
  clone?: string | null;
  ref_text?: string | null;
  temperature?: number | null;
  defaults?: V1ImageDefaults;
};

export type V1ImageDefaults = {
  steps?: unknown;
  cfg_scale?: unknown;
  size?: unknown;
  width?: unknown;
  height?: unknown;
  negative_prompt?: unknown;
  count?: unknown;
};

/** v1's image defaults (any layer: global, per engine) in v2's shape; what v1 left empty stays out. */
export function v1ImageDefaults(d: V1ImageDefaults | undefined): Partial<ImageDefaults> {
  if (!d || typeof d !== "object") return {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const size = /^(\d+)x(\d+)$/.exec(typeof d.size === "string" ? d.size.trim() : "");
  const out: Partial<ImageDefaults> = {
    ...(n(d.steps) ? { steps: n(d.steps) } : {}),
    ...(n(d.cfg_scale) !== undefined ? { cfg_scale: n(d.cfg_scale) } : {}),
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    ...(!size && n(d.width) && n(d.height) ? { width: n(d.width), height: n(d.height) } : {}),
    ...(typeof d.negative_prompt === "string" && d.negative_prompt.trim()
      ? { negative_prompt: d.negative_prompt.trim().slice(0, 2000) }
      : {}),
    ...(n(d.count) ? { count: n(d.count) } : {}),
  };
  // Anything out of v2's range is dropped rather than refused with the rest.
  return Object.fromEntries(
    Object.entries(out).filter(([k, v]) => ImageDefaults.shape[k as keyof ImageDefaults].safeParse(v).success),
  );
}

/** A v1 slug as a v2 service id (lowercase letters, digits and dashes, at most 32). */
export const v1ServiceId = (slug: string) =>
  slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32);

const IMAGE_DIALECT: Record<string, ServiceSettings["dialect"]> = {
  a1111: "a1111",
  sdcpp: "sdcpp",
  openai: "openai-images",
};

/** v1's language names to the codes v2 sends. */
const LANG: Record<string, string> = { spanish: "es", english: "en", español: "es" };

/** v1's own image engines and custom voices as v2 services; keys are not part of it. */
export function v1Services(config: unknown): Array<{ id: string; settings: ServiceSettings }> {
  const c = config as {
    images?: { custom?: Record<string, V1Service> };
    voice?: { tts?: { custom?: Record<string, V1Service> } };
  };
  const out: Array<{ id: string; settings: ServiceSettings }> = [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  for (const [slug, s] of Object.entries(c.images?.custom ?? {})) {
    if (!s.base_url || !v1ServiceId(slug)) continue;
    const defaults = v1ImageDefaults(s.defaults);
    out.push({
      id: v1ServiceId(slug),
      settings: {
        kind: "image",
        dialect: IMAGE_DIALECT[s.kind ?? "a1111"] ?? "a1111",
        label: s.label ?? slug,
        base_url: s.base_url,
        enabled: s.enabled !== false,
        needs_key: false,
        ...(str(s.model) ? { model: str(s.model) } : {}),
        ...(Object.keys(defaults).length ? { defaults } : {}),
      },
    });
  }
  for (const [slug, s] of Object.entries(c.voice?.tts?.custom ?? {})) {
    if (!s.base_url || !v1ServiceId(slug)) continue;
    const lang = str(s.language);
    out.push({
      id: v1ServiceId(slug),
      settings: {
        kind: "speech",
        dialect: "openai-speech",
        label: s.label ?? slug,
        base_url: s.base_url,
        enabled: s.enabled !== false,
        needs_key: false,
        ...(str(s.model) ? { model: str(s.model) } : {}),
        ...(str(s.voice) ? { voice: str(s.voice) } : {}),
        ...(lang ? { language: LANG[lang.toLowerCase()] ?? lang } : {}),
        ...(str(s.style) ? { style: str(s.style) } : {}),
        ...(str(s.clone) ? { clone: str(s.clone) } : {}),
        ...(str(s.ref_text) ? { ref_text: str(s.ref_text)?.slice(0, 2000) } : {}),
        ...(typeof s.temperature === "number" ? { temperature: s.temperature } : {}),
      },
    });
  }
  return out;
}

export async function importFromV1(
  apc: ApcSync,
  secrets: Secrets,
  opts: {
    url: string;
    home: string;
    v2Home: string;
    keys: boolean;
    skills: boolean;
    /** Adds services v2 does not have yet (by id); none means "do not import services". */
    services?: ((list: Array<{ id: string; settings: ServiceSettings }>) => string[]) | undefined;
    fetchImpl?: typeof fetch;
  },
) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(opts.url).hostname))
    throw new Error("v1 import only talks to a local daemon");
  let services: string[] = [];
  if (opts.services) {
    try {
      services = opts.services(v1Services(JSON.parse(fs.readFileSync(path.join(opts.home, "config.json"), "utf8"))));
    } catch {}
  }
  const skills = opts.skills ? importSkills(path.join(opts.home, "skills"), path.join(opts.v2Home, "skills")) : [];
  const keys = opts.keys ? importKeys(opts.home, secrets) : [];
  let token = "";
  try {
    token = fs.readFileSync(path.join(opts.home, "daemon.token"), "utf8").trim();
  } catch {}
  const res = await (opts.fetchImpl ?? fetch)(`${opts.url}/api/projects`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`v1 /projects: HTTP ${res.status}`);
  const list = ((await res.json()) as V1Project[]).filter((p) => !p.missing && p.name !== "default");
  let projects = 0;
  let agents = 0;
  for (const p of list) {
    try {
      const r = apc.register(p.path);
      projects++;
      agents += r.agents;
    } catch {
      // A folder v1 lists but that is not an APC project (or not on disk now) is skipped.
    }
  }
  return { projects, agents, keys, skills, services };
}
