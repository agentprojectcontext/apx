import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeExtensionInstall,
  extensionsVersion,
  openExtensionInstall,
  subscribeExtensionChanges,
} from "./extensionInstall.ts";

test("closing the connection dialog notifies Marketplace to refresh server status", () => {
  const before = extensionsVersion();
  let observed = before;
  const unsubscribe = subscribeExtensionChanges(() => {
    observed = extensionsVersion();
  });
  try {
    openExtensionInstall({ connect: "example" });
    assert.equal(observed, before);
    closeExtensionInstall();
    assert.equal(observed, before + 1);
  } finally {
    unsubscribe();
  }
});
