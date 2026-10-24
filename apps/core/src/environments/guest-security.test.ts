import assert from "node:assert/strict";
import { test } from "node:test";
import { egressRules } from "./guest-security.ts";

test("the probe user and agents reach loopback but never a resolver on it, so no name is looked up past the proxy", () => {
  const lines = egressRules()
    .split("\n")
    .map((l) => l.trim());
  for (const users of ["1001", "2001-2999"]) {
    const dns = lines.findIndex(
      (l) => l.startsWith(`meta skuid ${users} oifname "lo"`) && /th dport 53 reject/.test(l) && /tcp, udp/.test(l),
    );
    const loopback = lines.indexOf(`meta skuid ${users} oifname "lo" accept`);
    const rest = lines.indexOf(`meta skuid ${users} reject with icmpx type admin-prohibited`);
    assert.ok(dns >= 0, `${users}: no DNS rule`);
    assert.ok(dns < loopback && loopback < rest, `${users}: DNS must be refused before loopback is accepted`);
  }
  assert.ok(lines.includes("type filter hook forward priority -150; policy drop;"));
});
