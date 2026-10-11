import assert from "node:assert/strict";
import { test } from "node:test";
import { firstReachable, fromPairedCore, parseOpenLink, parsePairingLink } from "./pairing.ts";

test("the QR's link gives the code and the addresses; anything else is not a pairing", () => {
  assert.deepEqual(
    parsePairingLink("apx://pair?c=ABCD2345&u=http%3A%2F%2F192.168.1.20%3A7440&u=http%3A%2F%2F100.64.0.3%3A7440"),
    { code: "ABCD2345", urls: ["http://192.168.1.20:7440", "http://100.64.0.3:7440"] },
  );
  assert.equal(parsePairingLink("https://example.com/?c=ABCD2345"), undefined);
  assert.equal(parsePairingLink("apx://pair?u=http%3A%2F%2F10.0.0.2%3A7440"), undefined);
  assert.deepEqual(parsePairingLink("apx://pair?c=X&u=javascript:alert(1)"), { code: "X", urls: [] });
});

test("the first address that answers wins; none answering gives none", async () => {
  const up = new Set(["http://100.64.0.3:7440"]);
  const probe = async (u: string) => up.has(u);
  assert.equal(
    await firstReachable(["http://192.168.1.20:7440", "http://100.64.0.3:7440"], probe),
    "http://100.64.0.3:7440",
  );
  assert.equal(await firstReachable(["http://192.168.1.20:7440"], probe), undefined);
});

test("a link can name the chat to open, and one from the paired core does not pair again", () => {
  const link = parsePairingLink("apx://pair?c=ABCD2345&u=http%3A%2F%2F192.168.1.20%3A7440&t=home");
  assert.deepEqual(link, { code: "ABCD2345", urls: ["http://192.168.1.20:7440"], thread: "home" });
  assert.ok(link && fromPairedCore(link, "http://192.168.1.20:7440/"));
  assert.ok(link && !fromPairedCore(link, "http://100.64.0.3:7440"));
});

test("a notice's link opens the app, on its chat when it names one; it never pairs", () => {
  assert.deepEqual(parseOpenLink("apx://open?t=th%201"), { thread: "th 1" });
  assert.deepEqual(parseOpenLink("apx://open"), {});
  assert.equal(parseOpenLink("apx://pair?c=ABCD2345"), undefined);
  assert.equal(parsePairingLink("apx://open?t=home"), undefined);
});
