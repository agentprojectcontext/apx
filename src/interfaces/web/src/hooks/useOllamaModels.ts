import { useEffect, useMemo, useState } from "react";
import { Engines } from "../lib/api/engines";

// Ollama has no curated catalog: the models are whatever the user pulled onto
// that machine. So we ask the server. If it does not answer we fall back to the
// last list we saw (cached per provider slug) and, failing that, offer nothing —
// the field stays free-text either way.

interface Cached { models: string[]; ts: number }

const KEY = (slug: string) => `apx.ollama_models.${slug}`;

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

export interface OllamaProbeTarget { slug: string; base_url?: string }

export interface OllamaProbe {
  /** Models the server reported, or the cached ones when it is unreachable. */
  models: Record<string, string[]>;
  /** true = the server answered on this pass. Absent while still probing. */
  online: Record<string, boolean | undefined>;
}

/**
 * Probe every Ollama provider once per changed target set. Returns its live
 * model list plus whether the server actually answered, so callers can both
 * populate a dropdown and tell "connected" from "configured".
 */
export function useOllamaModels(targets: OllamaProbeTarget[]): OllamaProbe {
  // Stable identity so the effect does not refire on every parent render.
  const key = targets.map((tg) => `${tg.slug}|${tg.base_url || ""}`).sort().join(",");
  const list = useMemo(() => targets, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [models, setModels] = useState<Record<string, string[]>>({});
  const [online, setOnline] = useState<Record<string, boolean | undefined>>({});

  useEffect(() => {
    let alive = true;
    if (list.length === 0) { setModels({}); setOnline({}); return; }

    // Show the cache immediately; the probe overwrites it when it lands.
    setModels(Object.fromEntries(list.map((tg) => [tg.slug, readCache(tg.slug)])));

    (async () => {
      const nextModels: Record<string, string[]> = {};
      const nextOnline: Record<string, boolean> = {};
      await Promise.all(list.map(async (tg) => {
        try {
          const r = await Engines.models({ engine: "ollama", slug: tg.slug, base_url: tg.base_url });
          const got = Array.isArray(r.models) ? r.models : [];
          nextModels[tg.slug] = got;
          nextOnline[tg.slug] = true;
          writeCache(tg.slug, got);
        } catch {
          nextModels[tg.slug] = readCache(tg.slug);
          nextOnline[tg.slug] = false;
        }
      }));
      if (!alive) return;
      setModels(nextModels);
      setOnline(nextOnline);
    })();

    return () => { alive = false; };
  }, [list]);

  return { models, online };
}
