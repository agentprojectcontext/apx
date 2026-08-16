// LAN address discovery and bind validation for `apx panel share`.
//
// This is NOT a tunnel: nothing leaves the local network. The rules it enforces
// are the ones that keep that true — loopback stays the default, 0.0.0.0 is
// never chosen, and you cannot bind an address this machine does not have.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectLanAddresses,
  isPrivateIPv4,
  isLinkLocal,
  isLoopback,
  isWildcard,
  validateBindHost,
} from "#core/net/lan.js";

test("private ranges are recognised, public ones are not", () => {
  for (const ip of ["10.0.0.5", "172.16.4.2", "172.31.255.1", "192.168.1.40", "100.64.0.1"]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "193.168.1.1", "not.an.ip.x"]) {
    assert.equal(isPrivateIPv4(ip), false, ip);
  }
});

test("link-local, loopback and wildcard are each identified", () => {
  assert.equal(isLinkLocal("169.254.3.2"), true);
  assert.equal(isLinkLocal("192.168.1.1"), false);

  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("192.168.1.1"), false);

  for (const h of ["0.0.0.0", "::", "*"]) assert.equal(isWildcard(h), true, h);
  assert.equal(isWildcard("192.168.1.1"), false);
});

// 0.0.0.0 binds every interface present now AND every one that appears later.
// That is a different promise from "reachable on my network", so `share` must
// never produce it, even if asked.
test("the wildcard address is refused, with a reason that says why", () => {
  for (const h of ["0.0.0.0", "::", "any"]) {
    const r = validateBindHost(h);
    assert.equal(r.ok, false, h);
    assert.match(r.reason, /binds every interface/);
  }
});

test("loopback is always a valid bind", () => {
  assert.equal(validateBindHost("127.0.0.1").ok, true);
  assert.equal(validateBindHost("::1").ok, true);
});

test("an address this machine does not have is refused", () => {
  const r = validateBindHost("203.0.113.77"); // TEST-NET-3, never local
  assert.equal(r.ok, false);
  assert.match(r.reason, /not an address of this machine/);
});

test("an empty host is refused rather than silently defaulting", () => {
  assert.equal(validateBindHost("").ok, false);
  assert.equal(validateBindHost(null).ok, false);
});

test("detectLanAddresses returns well-formed, non-loopback IPv4 entries", () => {
  for (const a of detectLanAddresses()) {
    assert.match(a.address, /^\d{1,3}(\.\d{1,3}){3}$/, a.address);
    assert.equal(isLoopback(a.address), false);
    assert.equal(typeof a.iface, "string");
    assert.equal(typeof a.private, "boolean");
  }
});

// The first candidate is what `share` picks with no --host, so ordering is
// behaviour: a real private address beats a link-local one, which usually just
// means no DHCP answered.
test("link-local addresses sort last so they are never the default pick", () => {
  const ordered = detectLanAddresses();
  const firstLinkLocal = ordered.findIndex((a) => isLinkLocal(a.address));
  if (firstLinkLocal === -1) return; // none on this machine
  const lastReal = ordered.reduce((acc, a, i) => (isLinkLocal(a.address) ? acc : i), -1);
  assert.ok(firstLinkLocal > lastReal, "a link-local address must not precede a routable one");
});

// Regression: `apx panel share` binding a single LAN address used to EXCLUDE
// loopback, which took the CLI, the desktop app and /admin/web-token down with
// it — sharing the panel with a phone killed the local toolchain. The daemon
// now binds loopback plus the configured host, so this asserts the rule the
// bind logic depends on: a shared host is an ADDITIONAL address, never a move.
test("a shareable host is always distinct from loopback", () => {
  // Anything `share` can select must be a second address, not a replacement —
  // if it could pick loopback there would be nothing to add.
  for (const a of detectLanAddresses()) {
    assert.equal(isLoopback(a.address), false, `${a.address} must not be loopback`);
    assert.equal(isWildcard(a.address), false, `${a.address} must not be a wildcard`);
  }
});
