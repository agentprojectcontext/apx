import assert from "node:assert/strict";
import { test } from "node:test";
import { createHostFilePicker } from "./host-file-picker.ts";

test("only an explicitly local connection can select a host file; cancellation is not a selection", async () => {
  let calls = 0;
  let answer: string | undefined = "/backup.sqlite";
  const picker = createHostFilePicker(async () => {
    calls++;
    return answer;
  });
  assert.equal(picker.available(), false);
  assert.equal(await picker.pick(), undefined);
  assert.equal(calls, 0);
  picker.connect(true);
  assert.equal(picker.available(), true);
  assert.equal(await picker.pick(), "/backup.sqlite");
  answer = undefined;
  assert.equal(await picker.pick(), undefined);
  picker.connect(false);
  assert.equal(await picker.pick(), undefined);
  assert.equal(calls, 2);
});

test("a selection is discarded if the connection changes while the dialog is open", async () => {
  let finish: (file: string) => void = () => {
    throw new Error("dialog not opened");
  };
  const picker = createHostFilePicker(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  picker.connect(true);
  const selection = picker.pick();
  picker.connect(false);
  picker.connect(true);
  finish("/backup.sqlite");
  assert.equal(await selection, undefined);
});
