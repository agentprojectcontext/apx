// Prefer IPv4 for all outbound connections made by this process.
//
// Some networks — notably machines on Tailscale, or misconfigured dual-stack
// setups — advertise an IPv6 route that black-holes. A dual-stack host such as
// api.telegram.org then resolves to an unreachable AAAA address, and Node's
// fetch/undici stalls on it with ETIMEDOUT instead of falling back to the
// reachable IPv4 the way `curl` does. The symptom is every daemon outbound
// `fetch` failing ("fetch failed") — Telegram long-poll, some LLM providers —
// while the shell and `curl -4` work fine.
//
// Forcing ipv4first + disabling Happy-Eyeballs family auto-selection makes
// `fetch` use the reachable A record. On a healthy IPv6 network this is a no-op
// preference (IPv4 is still universally reachable); opt out with
// APX_NET_IPV4_FIRST=0 if you specifically need IPv6-first.
import dns from "node:dns";
import net from "node:net";

if (process.env.APX_NET_IPV4_FIRST !== "0") {
  // Available on Node ≥17; guarded for older runtimes.
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* older node — ignore */
  }
  // Available on Node ≥18.13; disabling it stops undici from racing an
  // unreachable IPv6 address and timing out before it tries IPv4.
  try {
    net.setDefaultAutoSelectFamily?.(false);
  } catch {
    /* older node — ignore */
  }
}
