import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ExtensionManifest } from "@apx/protocol";
import { tempDir } from "../testkit/platform.ts";
import { clearExtensionSession, savedExtensionSession } from "./sessions.ts";

test("versioned bridge caches count as saved sessions only if they hold a credential file", async () => {
  const home = tempDir("extension-session-layout-");
  try {
    const id = "example_store";
    const manifest = ExtensionManifest.parse({
      manifest: 2,
      id,
      name: "Example Store",
      version: "1.0.0",
      mcp: { shop: { command: "mcp-remote", args: ["https://mcp.example.com"] } },
    });
    const parent = path.join(home.path, "extension-data", id, "mcp-remote", "shop");
    const hash = "0".repeat(32);
    const metadata = path.join(parent, "mcp-remote-v1");
    const legacy = path.join(parent, "mcp-remote-0.1.38");
    fs.mkdirSync(metadata, { recursive: true });
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(metadata, `${hash}_client_info.json`), "registration");
    fs.writeFileSync(path.join(legacy, `${hash}_code_verifier.txt`), "pending");
    assert.equal(savedExtensionSession(home.path, id, manifest), false);
    fs.writeFileSync(path.join(legacy, `${hash}_tokens.json`), "oauth session");
    assert.equal(savedExtensionSession(home.path, id, manifest), true);
    clearExtensionSession(home.path, id, manifest);
    assert.equal(savedExtensionSession(home.path, id, manifest), false);
    assert.equal(fs.existsSync(legacy), false);
  } finally {
    await home.remove();
  }
});
