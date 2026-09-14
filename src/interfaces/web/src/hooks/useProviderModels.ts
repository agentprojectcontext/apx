import { useEffect, useMemo, useState } from "react";
import { Engines } from "../lib/api/engines";

// The live model catalog of a configured provider, asked through the daemon
// (`POST /api/engines/models` → core/engines/catalog.js) and shared by every
// picker on screen.
//
// Why live at all: the curated list in core/engines/presets.js is the OFFLINE
// fallback, and says so. Ollama's is empty ON PURPOSE — the models are whatever
// that machine pulled — so a picker built only from presets has nothing to show
// for the one provider whose catalog we can always read.
//
// Two things the probe needs that a bare engine id cannot give, and both were
// missing from the chat picker:
//   • slug     — the daemon looks the stored api_key up by PROVIDER SLUG, which
//                only coincides with the adapter id for the stock providers.
//   • base_url — Ollama is routinely NOT on localhost (a homelab box reached
//                over Tailscale). Omit it and the daemon probes 127.0.0.1,
//                which answers nothing and leaves the dropdown empty with no
//                error to show for it.

interface Cached { models: string[]; ts: number }

// Per-slug, not per-engine: two providers can run the same adapter against
// different machines or keys.
const KEY = (slug: string) => `apx.models.${slug}`;

function readCache(slug: string): string[] {
  try {
    const raw = localStorage.getItem(KEY(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Cached;
    return Array.isArray(parsed?.models) ? parsed.models : [];
  } catch { return []; }
}

function writeCache(slug: string, models: string[]) {
  try { localStorage.setItem(KEY(slug), JSON.stringify({ models, ts: Date.now() } satisfies Cached)); } catch { /* quota / private mode */ }
}

export interface ProviderTarget {
  slug: string;
  /** Adapter id. Defaults to the slug, exactly like the daemon does. */
  engine?: string;
  base_url?: string;
}

export interface ProviderModels {
  /** What the provider reported, or the last list we cached when it did not answer. */
  models: Record<string, string[]>;
  /** true = answered this pass. Absent while still probing. */
  online: Record<string, boolean | undefined>;
  /** A probe pass is in flight. `models` already holds the cache meanwhile. */
  probing: boolean;
}

interface Probe { models: string[]; ok: boolean; ts: number }

// One probe per (slug, engine, base_url) shared by the whole app: several
// pickers mounted at once, or a picker reopened, reuse the same answer instead
// of hammering the provider. A failure expires fast — a laptop that woke up, a
// key that was just pasted, an Ollama box that finished booting should not wait
// five minutes to be noticed.
const OK_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 30_000;

const memo = new Map<string, Probe>();
const inflight = new Map<string, Promise<Probe>>();

function targetKey(t: ProviderTarget): string {
  return `${t.slug}|${t.engine || t.slug}|${t.base_url || ""}`;
}

function fresh(p: Probe): boolean {
  return Date.now() - p.ts < (p.ok ? OK_TTL_MS : FAIL_TTL_MS);
}

async function probe(t: ProviderTarget): Promise<Probe> {
  const key = targetKey(t);
  const hit = memo.get(key);
  if (hit && fresh(hit)) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async (): Promise<Probe> => {
    try {
      const r = await Engines.models({ engine: t.engine || t.slug, slug: t.slug, base_url: t.base_url });
      const models = (Array.isArray(r.models) ? r.models : []).filter((m): m is string => typeof m === "string" && !!m);
      writeCache(t.slug, models);
      return { models, ok: true, ts: Date.now() };
    } catch {
      // Unreachable, no api_key, a 502 from the provider — all the same from
      // here: the last list we saw beats an empty dropdown, and every field
      // built on this stays free-text anyway.
      return { models: readCache(t.slug), ok: false, ts: Date.now() };
    }
  })()
    .then((p) => { memo.set(key, p); return p; })
    .finally(() => { inflight.delete(key); });

  inflight.set(key, run);
  return run;
}

/** Drop the memo so the next mount re-probes — after saving a provider, say. */
export function forgetProviderModels() {
  memo.clear();
}

function seed(list: ProviderTarget[]): Omit<ProviderModels, "probing"> {
  const models: Record<string, string[]> = {};
  const online: Record<string, boolean | undefined> = {};
  for (const t of list) {
    const hit = memo.get(targetKey(t));
    models[t.slug] = hit ? hit.models : readCache(t.slug);
    if (hit) online[t.slug] = hit.ok;
  }
  return { models, online };
}

/**
 * Probe every target once per changed target set. Returns each provider's model
 * list plus whether it actually answered, so callers can both fill a dropdown
 * and tell "connected" from "configured".
 *
 * `enabled: false` probes nothing — for pickers that should only reach the
 * network once the user opens them.
 */
export function useProviderModels(targets: ProviderTarget[], enabled = true): ProviderModels {
  // Stable identity so the effect does not refire on every parent render.
  const key = enabled ? targets.map(targetKey).sort().join(",") : "";
  const list = useMemo(() => (enabled ? targets : []), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [state, setState] = useState<ProviderModels>({ models: {}, online: {}, probing: false });

  useEffect(() => {
    if (list.length === 0) { setState({ models: {}, online: {}, probing: false }); return; }
    let alive = true;
    // Show what we already know immediately; the probe overwrites it when it
    // lands. Nothing here blocks on the network.
    setState({ ...seed(list), probing: true });
    (async () => {
      const done = await Promise.all(list.map(async (t) => [t.slug, await probe(t)] as const));
      if (!alive) return;
      setState({
        models: Object.fromEntries(done.map(([slug, p]) => [slug, p.models])),
        online: Object.fromEntries(done.map(([slug, p]) => [slug, p.ok])),
        probing: false,
      });
    })();
    return () => { alive = false; };
  }, [list]);

  return state;
}
