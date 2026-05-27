// `apx pair` — QR-based pairing for companion clients (Deck app, etc.).
//
// Calls the daemon's /pair/init endpoint (localhost-only on the daemon
// side), renders the QR in the terminal, then polls /pair/status until
// the device confirms. No state lives in the CLI — the daemon owns
// pairing_id lifetime and the issued client token.

import os from "node:os";
import qrcode from "qrcode-terminal";
import { http } from "../http.js";

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
};
const fmt = {
  bold:  (s) => `${c.bold}${s}${c.reset}`,
  dim:   (s) => `${c.dim}${s}${c.reset}`,
  green: (s) => `${c.green}${s}${c.reset}`,
  red:   (s) => `${c.red}${s}${c.reset}`,
  cyan:  (s) => `${c.cyan}${s}${c.reset}`,
  gray:  (s) => `${c.gray}${s}${c.reset}`,
};

// Pick a LAN IP the phone can reach. The daemon binds to 127.0.0.1 by
// default, which a device on the same WiFi cannot hit — but in our
// dev setup we tunnel via `adb reverse tcp:7430 tcp:7430`, so the QR
// pointing at 127.0.0.1 works through the USB bridge. For pure WiFi
// pairing, the user should bind APX_HOST=0.0.0.0 and we'll emit the
// LAN IP here instead.
function pickHostForQr({ host, port }) {
  if (host && host !== "0.0.0.0" && host !== "::" && host !== "127.0.0.1") {
    return host;
  }
  // When daemon binds to wildcard, prefer the first non-internal IPv4.
  if (host === "0.0.0.0" || host === "::") {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const i of list || []) {
        if (i.family === "IPv4" && !i.internal) return i.address;
      }
    }
  }
  // Fallback: loopback (works over `adb reverse`).
  return host || "127.0.0.1";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function cmdPair(args = {}) {
  const label = args.flags?.label || args._?.[0] || "";

  // 1. Ask daemon for a pairing nonce.
  let init;
  try {
    init = await http.post("/pair/init", {});
  } catch (e) {
    console.error(fmt.red(`pair init failed: ${e.message}`));
    process.exit(1);
  }

  const ttlSec = Math.round((init.ttl_ms || 90_000) / 1000);
  const qrHost = pickHostForQr({ host: init.daemon?.host, port: init.daemon?.port });
  const qrPort = init.daemon?.port || 7430;

  // 2. Build QR payload. Keep it small — devices read JSON.
  //    Fields: v=1 (schema), url, pid (pairing_id), fp (master fingerprint).
  const payload = {
    v: 1,
    url: `http://${qrHost}:${qrPort}`,
    pid: init.pairing_id,
    fp: init.fingerprint,
  };
  const encoded = JSON.stringify(payload);

  console.log("");
  console.log(`  ${fmt.bold("APX pairing")}  ${fmt.gray("·")}  ${fmt.dim(`expires in ${ttlSec}s`)}`);
  console.log("");
  qrcode.generate(encoded, { small: true }, (qr) => {
    console.log(qr);
  });
  console.log(`  ${fmt.gray("scan with APX Deck app on the device")}`);
  console.log(`  ${fmt.gray("url:")} ${fmt.cyan(payload.url)}   ${fmt.gray("fp:")} ${fmt.dim(init.fingerprint)}`);
  console.log("");

  // 3. Poll /pair/status until confirmed or expired.
  const start = Date.now();
  const deadline = start + (init.ttl_ms || 90_000) + 5_000;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      const s = await http.get(`/pair/status/${init.pairing_id}`);
      if (s.status === "confirmed") {
        console.log(`  ${fmt.green("●")} ${fmt.bold("paired")} ${fmt.gray("·")} ${s.device_label || ""}`);
        console.log(`    ${fmt.gray("client_id:")} ${s.client_id}`);
        console.log(`    ${fmt.dim("token stored on the device; CLI keeps using ~/.apx/daemon.token")}`);
        console.log("");
        return;
      }
      if (s.status === "expired" || s.status === "unknown") {
        console.log(`  ${fmt.red("○")} pairing expired — re-run ${fmt.bold("apx pair")}`);
        process.exit(1);
      }
    } catch (e) {
      // Transient errors are fine; keep polling.
    }
  }
  console.log(`  ${fmt.red("○")} pairing expired — re-run ${fmt.bold("apx pair")}`);
  process.exit(1);
}

export async function cmdPairList() {
  const { clients } = await http.get("/pair/list");
  if (!clients.length) {
    console.log(`\n  ${fmt.dim("no paired devices")}\n`);
    return;
  }
  console.log("");
  console.log(`  ${fmt.bold("paired devices")}  ${fmt.gray(`(${clients.length})`)}`);
  console.log("");
  for (const c of clients) {
    const seen = c.last_seen ? fmt.dim(`last seen ${c.last_seen}`) : fmt.dim("never seen");
    console.log(`  ${fmt.cyan(c.id.slice(0, 8))}  ${c.label.padEnd(20)}  ${fmt.gray(`…${c.token_suffix}`)}  ${seen}`);
  }
  console.log("");
}

export async function cmdPairRevoke(args = {}) {
  const id = args._?.[0];
  if (!id) {
    console.error(fmt.red("usage: apx pair revoke <client_id_prefix>"));
    process.exit(1);
  }
  // Allow short prefix: resolve via /pair/list.
  const { clients } = await http.get("/pair/list");
  const match = clients.find((c) => c.id === id || c.id.startsWith(id));
  if (!match) {
    console.error(fmt.red(`no paired device matches "${id}"`));
    process.exit(1);
  }
  await http.delete(`/pair/revoke/${match.id}`);
  console.log(`  ${fmt.green("●")} revoked ${match.label} ${fmt.gray(`(${match.id.slice(0, 8)})`)}`);
}
