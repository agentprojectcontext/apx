import assert from "node:assert/strict";
import { test } from "node:test";
import { totp } from "./totp.ts";

// RFC 6238, appendix B: the SHA-1 seed "12345678901234567890", 8 digits.
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("a seed gives the RFC's codes, as a base32 seed or an otpauth address", () => {
  const uri = `otpauth://totp/Acme:user@example.com?secret=${SEED}&digits=8&issuer=Acme`;
  for (const [s, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [2000000000, "69279037"],
  ] as const)
    assert.equal(totp(uri, s * 1000), code);
  assert.equal(totp(SEED.toLowerCase().replace(/(.{4})/g, "$1 "), 59_000), "287082");
});

test("anything that is not a TOTP seed is refused", () => {
  assert.throws(() => totp("hunter2!", 0), /seed/);
  assert.throws(() => totp(`otpauth://hotp/Acme?secret=${SEED}`, 0), /time-based/);
  assert.throws(() => totp(`otpauth://totp/Acme?secret=${SEED}&digits=4`, 0), /seed/);
});
