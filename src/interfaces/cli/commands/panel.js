// apx panel — reach the admin panel from another device on the same network.
//
//   apx panel status
//   apx panel share   [--host 192.168.1.40]
//   apx panel unshare
//
// This binds a second, specific LAN address. It is NOT a tunnel: nothing leaves
// the local network. Loopback stays the default, sharing is always explicit,
// and the daemon's auth is untouched — the URL carries the token because
// /admin/web-token is loopback-only by design, so a phone cannot fetch it.
import { readConfig, writeConfig, effectivePort, effectiveHost } from "#core/config/index.js";
import { detectLanAddresses, validateBindHost, isLoopback, isWildcard } from "#core/net/lan.js";

export const PANEL_USAGE = {
  status: "apx panel status",
  share: "apx panel share [--host <ip>]",
  unshare: "apx panel unshare",
};

export async function cmdPanelStatus() {
  const cfg = readConfig();
  const host = effectiveHost(cfg);
  const port = effectivePort(cfg);

  if (isLoopback(host)) {
    console.log(`panel: local only — http://${host}:${port}`);
    console.log("  Nothing on your network can reach it.");
    console.log("  To reach it from your phone: apx panel share");
    return;
  }

  // 0.0.0.0 is a bigger promise than "reachable on my network": it also covers
  // every interface that appears LATER — a VPN, a hotspot, a bridged container.
  // Worth calling out separately rather than reporting it as ordinary sharing.
  if (isWildcard(host)) {
    console.log(`panel: bound to EVERY interface — ${host}:${port}`);
    const addrs = detectLanAddresses();
    if (addrs.length) {
      console.log(`  Currently reachable at: ${addrs.map((a) => `http://${a.address}:${port}`).join(", ")}`);
    }
    console.log("  This also covers interfaces that appear later — a VPN, a hotspot, a");
    console.log("  container bridge. Auth still applies, but the surface is wider than");
    console.log("  it needs to be.");
    console.log("");
    console.log("  Narrow it to one address: apx panel share");
    console.log("  Turn it off entirely:    apx panel unshare");
    return;
  }

  console.log(`panel: SHARED on your network — http://${host}:${port}`);
  console.log(`  Anyone on this network who has the URL and the token can open it.`);
  console.log(`  To stop: apx panel unshare`);
}

export async function cmdPanelShare(args) {
  const cfg = readConfig();
  const port = effectivePort(cfg);

  const requested = args?.flags?.host;
  const candidates = detectLanAddresses();

  if (!requested && candidates.length === 0) {
    console.error("apx panel share: no network address found on this machine.");
    console.error("  Are you connected to a network? Pass one explicitly with --host <ip>.");
    process.exit(1);
  }

  const host = requested || candidates[0].address;
  const check = validateBindHost(host);
  if (!check.ok) {
    console.error(`apx panel share: ${check.reason}`);
    process.exit(1);
  }

  cfg.host = host;
  writeConfig(cfg);

  const iface = candidates.find((c) => c.address === host)?.iface;

  console.log(`panel shared on ${host}:${port}${iface ? ` (${iface})` : ""}`);
  console.log("");
  console.log(`  URL for the other device:  http://${host}:${port}/`);
  console.log("");
  // Deliberately NOT the daemon's master token. Handing that to a phone gives
  // it the same power as the CLI, cannot be revoked without rotating the token
  // every local tool depends on, and leaves no record the device exists —
  // which is the exact thing pairing was built to avoid (see token-store.js).
  // It would not even last: the master token is regenerated on every restart.
  console.log("  Authorise the device by PAIRING it, not by copying a token:");
  console.log("    the panel → Settings → Devices → Pair device, then scan the QR.");
  console.log("");
  console.log("  Pairing gives that device its OWN token, which survives restarts,");
  console.log("  shows up under Paired devices, and can be revoked on its own without");
  console.log("  disturbing anything else.");
  console.log("");
  // Say plainly what changed. A LAN can be a café or a coworking space.
  console.log("  What this means: anyone on this network can now REACH the panel.");
  console.log("  They cannot use it without pairing. Run `apx panel unshare` when done.");
  if (candidates.length > 1) {
    const others = candidates.filter((c) => c.address !== host).map((c) => `${c.address} (${c.iface})`);
    console.log(`  Other addresses on this machine: ${others.join(", ")}`);
  }
  console.log("");
  console.log("  Restart the daemon for the new binding to take effect: apx restart");
}

export async function cmdPanelUnshare() {
  const cfg = readConfig();
  const port = effectivePort(cfg);
  const was = effectiveHost(cfg);

  if (isLoopback(was)) {
    console.log("panel is already local only — nothing to do");
    return;
  }

  cfg.host = "127.0.0.1";
  writeConfig(cfg);

  console.log(`panel is local only again — http://127.0.0.1:${port}`);
  console.log(`  Was ${was}. Nothing on your network can reach it now.`);
  console.log("  Restart the daemon to apply: apx restart");
}
