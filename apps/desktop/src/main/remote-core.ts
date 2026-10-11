// Before the desktop app restarts into its update, a server it reaches over SSH updates its own core first: the panel
// that server serves may be older than the one that offers both at once, and the app's new panel then meets a new core.

type Fetch = typeof fetch;

async function rpc(url: string, method: string, params: object, f: Fetch, effect = false): Promise<unknown> {
  const r = await f(`${url}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(effect ? { "idempotency-key": crypto.randomUUID() } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(effect ? 25 * 60_000 : 20_000),
  });
  const body = (await r.json()) as { ok?: boolean; result?: unknown };
  return body.ok ? body.result : undefined;
}

/** Updates the core at `url` when it is a release install behind the newest; then waits for it to answer again. */
export async function updateRemoteCore(url: string | undefined, f: Fetch = fetch, backMs = 120_000): Promise<boolean> {
  if (!url) return false;
  try {
    const s = (await rpc(url, "system.updates", {}, f)) as { behind?: number; source?: string } | undefined;
    if (!s?.behind || s.source !== "release") return false;
    const r = (await rpc(url, "system.update", {}, f, true)) as { ok?: boolean; restart?: boolean } | undefined;
    if (!r?.ok) return false;
    if (r.restart) {
      const until = Date.now() + backMs;
      await new Promise((ok) => setTimeout(ok, 1500));
      while (Date.now() < until) {
        if (await rpc(url, "system.health", {}, f).catch(() => undefined)) break;
        await new Promise((ok) => setTimeout(ok, 1000));
      }
    }
    return true;
  } catch {
    // The app's own update goes on: the server's can be done from its panel afterwards.
    return false;
  }
}
