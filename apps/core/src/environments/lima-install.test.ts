import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installLima } from "./lima-install.ts";

test("a tampered Lima download never installs or leaves partial files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-lima-install-"));
  const download: typeof fetch = async () => new Response("tampered archive");
  try {
    await assert.rejects(
      installLima(root, new AbortController().signal, () => {}, download),
      /checksum/,
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a canceled runtime download cleans its staging directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-lima-cancel-"));
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
    fs.rmSync(root, { recursive: true, force: true });
  }
});
