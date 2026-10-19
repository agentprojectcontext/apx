import assert from "node:assert/strict";
import { test } from "node:test";
import { rfbInput } from "./rfb-input.ts";

test("RFB display handshake survives fragmented/coalesced frames while control inputs are fenced dynamically", () => {
  const written: Buffer[] = [];
  let manual = false;
  const input = rfbInput(
    () => manual,
    (bytes) => written.push(bytes),
  );
  input(Buffer.from("RFB 003."));
  assert.equal(written.length, 0);
  input(Buffer.concat([Buffer.from("008\n"), Buffer.from([1, 1])]));
  const view = Buffer.from([3, 1, 0, 0, 0, 0, 0, 20, 0, 20]);
  const key = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]);
  const pointer = Buffer.from([5, 1, 0, 20, 0, 20]);
  const caps = Buffer.from([6, 0, 0, 0, 255, 255, 255, 252, 1, 0, 0, 0]);
  const clipboard = Buffer.from([6, 0, 0, 0, 0, 0, 0, 1, 65]);
  input(Buffer.concat([view, key, pointer, clipboard, caps]));
  assert.equal(written.length, 4);
  assert.deepEqual(written[3], view);
  manual = true;
  input(Buffer.concat([key, pointer, clipboard, caps]));
  assert.deepEqual(written.slice(4), [key, pointer, clipboard, caps]);
  manual = false;
  input(key.subarray(0, 3));
  input(Buffer.concat([key.subarray(3), view]));
  assert.equal(written.length, 9);
  assert.deepEqual(written[8], view);
});

test("RFB refuses unsupported security, unknown message types and oversized clipboard lengths", () => {
  const create = () =>
    rfbInput(
      () => true,
      () => {},
    );
  const invalid = create();
  invalid(Buffer.from("RFB 003.008\n"));
  assert.throws(() => invalid(Buffer.from([2])), /security/);
  const ready = create();
  ready(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
  assert.throws(() => ready(Buffer.from([199])), /Unsupported/);
  const large = create();
  large(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
  assert.throws(() => large(Buffer.from([6, 0, 0, 0, 0, 32, 0, 0])), /limit/);
});
