import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { removeDir, tempDir } from "../testkit/platform.ts";
import { installLima } from "./lima-install.ts";

test("a tampered Lima download never installs or leaves partial files", async () => {
  const root = tempDir("apx-lima-install-").path;
  const download: typeof fetch = async () => new Response("tampered archive");
  try {
    await assert.rejects(
      installLima(root, new AbortController().signal, () => {}, download),
      /checksum/,
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    await removeDir(root);
  }
});

test("a canceled runtime download cleans its staging directory", async () => {
  const root = tempDir("apx-lima-cancel-").path;
  const controller = new AbortController();
  const download: typeof fetch = async () => {
    controller.abort();
    return new Response("unused");
  };
  try {
    await assert.rejects(
      installLima(root, controller.signal, () => {}, download),
      /abort/i,
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    await removeDir(root);
  }
});
