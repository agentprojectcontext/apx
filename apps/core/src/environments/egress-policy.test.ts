import assert from "node:assert/strict";
import { test } from "node:test";
import { publicDestination, vmAddressAllowed } from "./egress-policy.ts";

test("VM egress excludes special ranges, mapped IPv6, host addresses and connected public networks", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.1.1",
    "192.168.5.2",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:7f00:1",
    "::ffff:192.168.0.1",
    "2002:c0a8:101::1",
    "2001:db8::1",
  ])
    assert.equal(vmAddressAllowed(address, {}), false, address);
  assert.equal(vmAddressAllowed("93.184.216.34", {}), true);
  assert.equal(vmAddressAllowed("2606:4700:4700::1111", {}), true);
  const interfaces = {
    en0: [
      {
        address: "93.184.216.1",
        family: "IPv4" as const,
        cidr: "93.184.216.1/24",
        netmask: "255.255.255.0",
        mac: "00:00:00:00:00:00",
        internal: false,
      },
      {
        address: "2606:4700:4700::2",
        family: "IPv6" as const,
        cidr: "2606:4700:4700::2/64",
        netmask: "ffff:ffff:ffff:ffff::",
        mac: "00:00:00:00:00:00",
        internal: false,
        scopeid: 0,
      },
    ],
  };
  assert.equal(vmAddressAllowed("93.184.216.34", interfaces), false);
  assert.equal(vmAddressAllowed("2606:4700:4700::1111", interfaces), false);
});

test("VM DNS validates every answer and returns the pinned destination without a second resolution", async () => {
  let calls = 0;
  const policy = {
    allowed: (address: string) => vmAddressAllowed(address, {}),
    lookup: async () => {
      calls++;
      return [{ address: "93.184.216.34", family: 4 }];
    },
  };
  const result = await publicDestination("https://example.com/path?q=1", policy);
  assert.equal(result.address, "93.184.216.34");
  assert.equal(result.port, 443);
  assert.equal(calls, 1);
  await assert.rejects(
    publicDestination("https://example.com", {
      ...policy,
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    /not public/,
  );
  for (const url of [
    "file:///etc/passwd",
    "http://user:password@example.com",
    "http://2130706433",
    "https://[::ffff:7f00:1]",
  ])
    await assert.rejects(publicDestination(url, policy));
});
