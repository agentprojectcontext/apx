import assert from "node:assert/strict";
import { test } from "node:test";
import { describeExposure, planExposure, tailscaleDnsName } from "./expose-plan.ts";

const token = () => "generated";

test("lan listens on every address and creates a token when there is none", () => {
  const r = planExposure({ APX_PORT: "7500", APX_PUBLIC_URL: "https://old.example" }, "lan", { token });
  assert.deepEqual(r, {
    vars: { APX_PORT: "7500", APX_TOKEN: "generated", APX_HOST: "0.0.0.0" },
    generatedToken: "generated",
  });
});

test("tailscale keeps the core on loopback, publishes the name and keeps an existing token", () => {
  const r = planExposure({ APX_HOST: "0.0.0.0", APX_TOKEN: "kept" }, "tailscale", {
    tailscaleUrl: "https://box.tail0.ts.net",
    token,
  });
  assert.deepEqual(r, { vars: { APX_TOKEN: "kept", APX_PUBLIC_URL: "https://box.tail0.ts.net" } });
  assert.throws(() => planExposure({}, "tailscale", { token }));
});

test("off removes the exposure but keeps the token", () => {
  const r = planExposure({ APX_HOST: "0.0.0.0", APX_PUBLIC_URL: "https://x", APX_TOKEN: "kept" }, "off");
  assert.deepEqual(r, { vars: { APX_TOKEN: "kept" } });
});

test("reads the MagicDNS name from tailscale status", () => {
  assert.equal(tailscaleDnsName('{"Self":{"DNSName":"box.tail0.ts.net."}}'), "box.tail0.ts.net");
  assert.equal(tailscaleDnsName('{"Self":{}}'), undefined);
  assert.equal(tailscaleDnsName("not json"), undefined);
});

test("describes each exposure", () => {
  assert.match(describeExposure({}), /only this computer/);
  assert.match(describeExposure({ APX_HOST: "0.0.0.0" }), /0\.0\.0\.0/);
  assert.match(describeExposure({ APX_PUBLIC_URL: "https://box.ts.net" }), /stays on this computer/);
});
