import assert from "node:assert/strict";
import { test } from "node:test";
import { countryOf, whatsappDigits } from "./phone.ts";

const digits = (typed: string, o?: Parameters<typeof whatsappDigits>[1]) => {
  const r = whatsappDigits(typed, o);
  return "digits" in r ? r.digits : `problem: ${r.problem}`;
};

test("a Peruvian number written the local way gets 51 in front, once", () => {
  assert.equal(digits("976 666 004", { country: "PE" }), "51976666004");
  assert.equal(digits("(976) 666-004", { country: "PE" }), "51976666004");
  // Already international, with or without "+": never 51 51.
  assert.equal(digits("51976666004", { country: "PE" }), "51976666004");
  assert.equal(digits("+51 976 666 004", { country: "PE" }), "51976666004");
  assert.equal(digits(digits("976666004", { country: "PE" }), { country: "PE" }), "51976666004");
});

test("an Argentine mobile always goes as 54 9, however it was written", () => {
  assert.equal(digits("11 2345 6789", { country: "AR" }), "5491123456789");
  assert.equal(digits("011 15 2345-6789", { country: "AR" }), "5491123456789");
  assert.equal(digits("0223 15 555-0000", { country: "AR" }), "5492235550000");
  assert.equal(digits("+54 11 2345 6789"), "5491123456789");
  assert.equal(digits("+54 9 11 2345 6789"), "5491123456789");
  assert.equal(digits("5491123456789", { country: "AR", stored: true }), "5491123456789");
  assert.equal(digits("541123456789", { stored: true }), "5491123456789");
});

test("an international number stays as it is, whatever the owner's country", () => {
  assert.equal(digits("+51 976 666 004", { country: "AR" }), "51976666004");
  assert.equal(digits("51976666004", { country: "AR", stored: true }), "51976666004");
  assert.equal(digits("0051976666004", { country: "AR" }), "51976666004");
  assert.equal(digits("+1 415 555 2671", { country: "PE" }), "14155552671");
  assert.equal(digits("+55 11 98765-4321"), "5511987654321");
  // Mexico's mobiles go without the 1 after 52 that they once carried.
  assert.equal(digits("+52 1 55 1234 5678"), "525512345678");
});

test("garbage, a number too short, or one with no country code and no country to assume are refused", () => {
  assert.match(digits("abc"), /^problem: "abc" is not a phone number/);
  assert.match(digits("call me"), /not a phone number/);
  assert.match(digits("123", { country: "AR" }), /not a phone number/);
  assert.match(digits("976 666 004"), /^problem: 976 666 004 has no country code: write it with one/);
  // Read as an Argentine number it is not one, and as an international one neither (+976 is Mongolia's).
  assert.match(digits("976 666 004", { country: "AR" }), /not a valid phone number in AR and has no country code/);
  assert.match(digits("+976666004"), /is not a valid phone number: check its digits/);
});

test("the country of a known number", () => {
  assert.equal(countryOf("5491100000001@s.whatsapp.net"), "AR");
  assert.equal(countryOf("+51976666004"), "PE");
  assert.equal(countryOf("976666004"), undefined);
  assert.equal(countryOf(undefined), undefined);
});
