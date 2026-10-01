import assert from "node:assert/strict";
import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { test } from "node:test";
import { decryptChromium, registrable, toDetails } from "./cookies.ts";

test("a leading dot makes a domain cookie; without it the cookie stays host-only", () => {
  const domain = toDetails(".example.com", "sid", "v", "/", true, true, "lax", 2_000_000_000);
  assert.equal(domain.domain, ".example.com");
  assert.equal(domain.url, "https://example.com/");
  const hostOnly = toDetails("app.example.com", "sid", "v", "/x", false, false, "lax");
  assert.equal(hostOnly.domain, undefined);
  assert.equal(hostOnly.url, "http://app.example.com/x");
  assert.equal(hostOnly.expirationDate, undefined);
});

test("__Host- cookies never get a domain and always use path /", () => {
  const c = toDetails(".example.com", "__Host-token", "v", "/deep", true, true, "strict");
  assert.equal(c.domain, undefined);
  assert.equal(c.path, "/");
});

test("SameSite=None without Secure is downgraded instead of rejected", () => {
  assert.equal(toDetails("example.com", "a", "v", "/", false, false, "no_restriction").sameSite, "unspecified");
  assert.equal(toDetails("example.com", "a", "v", "/", true, false, "no_restriction").sameSite, "no_restriction");
});

test("Chromium v10 values decrypt, with and without the host-hash prefix", () => {
  const key = pbkdf2Sync("secret", "saltysalt", 1003, 16, "sha1");
  const enc = (plain: Buffer) => {
    const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    return Buffer.concat([Buffer.from("v10"), c.update(plain), c.final()]);
  };
  assert.equal(decryptChromium(enc(Buffer.from("hello")), key, "example.com", 23), "hello");
  const prefixed = Buffer.concat([createHash("sha256").update("example.com").digest(), Buffer.from("hello")]);
  assert.equal(decryptChromium(enc(prefixed), key, "example.com", 24), "hello");
  assert.equal(decryptChromium(Buffer.from("v11xxxx"), key, "example.com", 24), undefined);
});

test("domains group by registrable name, country second-levels included", () => {
  assert.equal(registrable(".www.example.com"), "example.com");
  assert.equal(registrable("tienda.acme.com.ar"), "acme.com.ar");
  assert.equal(registrable("a.b.example.co.uk"), "example.co.uk");
  assert.equal(registrable("example.io"), "example.io");
});
