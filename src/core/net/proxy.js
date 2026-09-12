// Per-engine egress proxy: route ONE provider's traffic through a tunnel and
// leave everything else on the default route.
//
// Why not HTTPS_PROXY / NODE_USE_ENV_PROXY: those are process-wide. The daemon
// talks to Telegram, several model providers, the vault and the update check
// from the same process, and pushing all of it down one tunnel is slower and a
// privacy change nobody asked for. A dispatcher passed per request scopes the
// change to the calls that want it.
//
// It is also what keeps Tailscale out of the fight. A machine-wide VPN and
// Tailscale both want the routing table; a proxy owns no routes at all — the
// tunnel lives behind the proxy's own address (a container, a remote host),
// and this machine's networking is untouched.
//
// Configured per engine, so `engines.zen.proxy` moves Zen and nothing else:
//   "engines": { "zen": { "proxy": "http://127.0.0.1:8888" } }
import { ProxyAgent, fetch as undiciFetch } from "undici";

/** One agent per proxy URL — each holds a connection pool worth reusing. */
const agents = new Map();

/**
 * Dispatcher for a proxy URL, or undefined when no proxy is configured (the
 * call then takes the default route, which is the normal case).
 *
 * Throws rather than falling back when the URL is unusable. A proxy that is
 * configured but silently skipped would send the traffic out the plain
 * interface — the exact thing the operator set it up to avoid — and it would
 * look like it worked. Failing the call is the honest outcome.
 */
export function dispatcherFor(proxyUrl) {
  const uri = typeof proxyUrl === "string" ? proxyUrl.trim() : "";
  if (!uri) return undefined;

  let agent = agents.get(uri);
  if (!agent) {
    try {
      agent = new ProxyAgent(uri);
    } catch (e) {
      throw new Error(
        `invalid proxy URL ${JSON.stringify(uri)}: ${e.message}. ` +
          `Expected something like "http://127.0.0.1:8888".`
      );
    }
    agents.set(uri, agent);
  }
  return agent;
}

/**
 * The fetch to use for a provider: the global one when it has no proxy, and
 * undici's own when it does.
 *
 * Why not hand a `dispatcher` to the global fetch — the obvious shape, and the
 * one every example shows. Node's global fetch is served by the undici BUNDLED
 * INSIDE NODE (7.16.0 on the Node this was written against) while `new
 * ProxyAgent()` comes from the undici in node_modules (8.x). Mixing them throws
 * `InvalidArgumentError: invalid onRequestStart method` — the two builds
 * disagree about the internal handler interface. Pinning the dependency to
 * whatever Node currently bundles would work until the next Node bumps it, and
 * fail loudly in production rather than here. Taking both halves from the same
 * package removes the coupling for good.
 */
export function fetchThrough(proxyUrl) {
  const agent = dispatcherFor(proxyUrl);
  if (!agent) return fetch;
  return (url, options = {}) => undiciFetch(url, { ...options, dispatcher: agent });
}

/** Close every pooled agent. Tests and shutdown paths; safe to call twice. */
export async function closeProxyAgents() {
  const open = [...agents.values()];
  agents.clear();
  await Promise.all(open.map((a) => a.close().catch(() => {})));
}
