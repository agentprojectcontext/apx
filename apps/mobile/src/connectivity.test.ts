import assert from "node:assert/strict";
import { test } from "node:test";
import { addressKind, diagnose, hasInternet } from "./connectivity.ts";

test("a core's address tells a tailnet from the home network", () => {
  assert.equal(addressKind("http://100.101.102.103:7440"), "tailscale");
  assert.equal(addressKind("https://acme-mac.tail1234.ts.net"), "tailscale");
  assert.equal(addressKind("http://192.168.1.20:7440"), "local");
  assert.equal(addressKind("http://10.0.0.5:7440"), "local");
  assert.equal(addressKind("http://172.20.0.5:7440"), "local");
  assert.equal(addressKind("http://acme-mac.local:7440"), "local");
  assert.equal(addressKind("http://100.10.0.1:7440"), "other");
  assert.equal(addressKind("https://apx.example.com"), "other");
  assert.equal(addressKind("not a url"), "other");
});

test("no internet comes first; with internet, the address says what to check", () => {
  assert.equal(diagnose(false, "tailscale"), "noInternet");
  assert.equal(diagnose(true, "tailscale"), "tailscale");
  assert.equal(diagnose(true, "local"), "localNetwork");
  assert.equal(diagnose(true, "other"), "server");
});

test("the internet is up when any probe answers", async () => {
  assert.equal(await hasInternet(async () => false), false);
  assert.equal(await hasInternet(async (u) => u.includes("cloudflare")), true);
});
