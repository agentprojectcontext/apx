// LAN address discovery, for reaching the panel from a phone on the same
// network.
//
// This is deliberately NOT a tunnel. Nothing leaves the local network: the
// daemon binds a second, specific interface address and that is all. The threat
// model of a home LAN is not the threat model of a guessable public hostname,
// which is why this is acceptable where a public tunnel is not — see
// docs-internal/secretary/04-BACKLOG-agent-inbox.md § C.
import os from "node:os";

/** Bind addresses that are never chosen automatically. */
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/**
 * Every non-internal IPv4 address on this machine, best candidate first.
 *
 * Ordering matters because the first one is what `apx panel share` will pick:
 * ordinary private ranges (a home or office network) come before link-local
 * autoconfiguration addresses, which usually mean "no DHCP happened" and are
 * rarely what someone wants to type into a phone.
 *
 * @returns {{ address: string, iface: string, cidr: string|null, private: boolean }[]}
 */
export function detectLanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();

  for (const [iface, addrs] of Object.entries(ifaces || {})) {
    for (const a of addrs || []) {
      if (!a || a.internal) continue;
      // Node <18.4 reported family as the string "IPv4"; newer versions use 4.
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (LOOPBACK.has(a.address)) continue;
      out.push({
        address: a.address,
        iface,
        cidr: a.cidr || null,
        private: isPrivateIPv4(a.address),
      });
    }
  }

  return out.sort((x, y) => {
    // Real private addresses first, link-local last.
    const rank = (v) => (isLinkLocal(v.address) ? 2 : v.private ? 0 : 1);
    const d = rank(x) - rank(y);
    return d !== 0 ? d : x.address.localeCompare(y.address);
  });
}

/** RFC1918 plus carrier-grade NAT — "an address someone else's router gave me". */
export function isPrivateIPv4(address) {
  const p = String(address || "").split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (e.g. Tailscale)
  return false;
}

/** 169.254.0.0/16 — self-assigned when no DHCP answered. */
export function isLinkLocal(address) {
  const p = String(address || "").split(".").map(Number);
  return p[0] === 169 && p[1] === 254;
}

export function isLoopback(address) {
  return LOOPBACK.has(String(address || "").trim());
}

/** Binds every interface, present and future. Never chosen automatically. */
export function isWildcard(address) {
  const h = String(address || "").trim();
  return h === "0.0.0.0" || h === "::" || h === "*";
}

/**
 * Validate a host the user asked to bind.
 *
 * `0.0.0.0` is refused on purpose. It binds every interface present now AND
 * every one that appears later — a VPN, a hotspot, a bridged container — which
 * is a different and much larger promise than "reachable on my home network".
 * The specific address is always available instead.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateBindHost(host) {
  const h = String(host || "").trim();
  if (!h) return { ok: false, reason: "no host given" };

  if (h === "0.0.0.0" || h === "::" || h.toLowerCase() === "any") {
    return {
      ok: false,
      reason:
        "0.0.0.0 binds every interface, including ones that appear later (a VPN, a hotspot, " +
        "a bridged container). Bind a specific address instead — `apx panel share` picks one.",
    };
  }

  if (isLoopback(h)) return { ok: true };

  const known = detectLanAddresses().map((a) => a.address);
  if (!known.includes(h)) {
    return {
      ok: false,
      reason:
        `${h} is not an address of this machine` +
        (known.length ? ` — available: ${known.join(", ")}` : " (no external interface found)"),
    };
  }
  return { ok: true };
}
