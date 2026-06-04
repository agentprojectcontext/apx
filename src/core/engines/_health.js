// Shared probes used by engine adapters to implement their own `.health()`.
// These used to live inline in model-router.js, which had a switch statement
// per provider — moved here so each adapter owns its own health logic.

/**
 * Reachability ping. Returns { ok, status?, reason? }. Catches abort/timeout
 * cleanly so callers can present a consistent shape.
 */
export async function pingUrl(url, { timeoutMs = 800, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      fetch(url, { signal: ctrl.signal, headers }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    const msg = e?.message || "unreachable";
    return { ok: false, reason: /abort|timeout/i.test(msg) ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Same as pingUrl but parses the response body when 2xx. Returns
 * { ok, status?, reason?, json? }.
 */
export async function fetchJsonWithTimeout(url, { timeoutMs = 800, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, json };
  } catch (e) {
    const msg = e?.message || "unreachable";
    return { ok: false, reason: /abort|timeout/i.test(msg) ? "timeout" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a "model is loaded?" predicate for Ollama-style `/api/tags` payloads.
 * Matches by exact name first, then by "name:" prefix so `qwen3` matches
 * `qwen3:32b`. Returns { present, available }.
 */
export function modelInOllamaTags(tagsJson, candidateModel) {
  const list = Array.isArray(tagsJson?.models) ? tagsJson.models : [];
  const names = list.map((m) => m?.name).filter((n) => typeof n === "string");
  if (!candidateModel) return { present: true, available: names };
  const wanted = String(candidateModel).trim();
  if (!wanted) return { present: true, available: names };
  if (names.includes(wanted)) return { present: true, available: names };
  const prefix = wanted + ":";
  if (names.some((n) => n.startsWith(prefix))) return { present: true, available: names };
  return { present: false, available: names };
}
