// apx pair: a one-time code (and link) another device trades for its own token.
import { type ApxClient, pairingLink } from "@apx/protocol/client";

export async function pair(client: ApxClient): Promise<void> {
  const r = await client.call("devices.pair_start", {});
  const expires = new Date(r.expires_at);
  const minutes = Math.max(1, Math.round((expires.getTime() - Date.now()) / 60_000));
  console.log(`Pairing code: ${r.code}`);
  console.log(`Expires at ${expires.toLocaleTimeString()} (in about ${minutes} min)`);
  if (!r.urls.length) {
    console.log("\nThe core only listens on this computer, so no other device can reach it yet.");
    console.log("Expose it first (apx expose tailscale | lan), restart it, and run apx pair again.");
    return;
  }
  console.log("\nAddresses a device may reach this core on:");
  for (const u of r.urls) console.log(`  ${u}`);
  console.log(`\nIn the APX app, open Pair and paste the link, or enter an address and the code:`);
  console.log(`  ${pairingLink({ code: r.code, urls: r.urls })}`);
}
