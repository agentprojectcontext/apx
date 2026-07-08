import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PreviewManager } from "#core/artifacts/preview.js";
import { detectProviders } from "#core/artifacts/tunnel.js";

function tmpStore() {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "apx-artprev-"));
  fs.mkdirSync(path.join(store, "artifacts"), { recursive: true });
  return store;
}

function write(store, name, content) {
  fs.writeFileSync(path.join(store, "artifacts", name), content);
}

async function getText(url) {
  const r = await fetch(url);
  return { status: r.status, body: await r.text(), ct: r.headers.get("content-type") };
}

test("preview serves HTML with a live-reload snippet injected", async () => {
  const store = tmpStore();
  write(store, "page.html", "<!doctype html><html><body><h1>Hi</h1></body></html>");
  const mgr = new PreviewManager();
  try {
    const view = await mgr.start({ storagePath: store, name: "page.html", projectId: "1" });
    assert.equal(view.kind, "html");
    const res = await getText(view.url);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("<h1>Hi"), "original markup preserved");
    assert.ok(res.body.includes("EventSource"), "reload snippet injected");
  } finally {
    await mgr.stopAll();
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("preview wraps a single-file React component in an HTML shell", async () => {
  const store = tmpStore();
  write(store, "app.jsx",
    "import { useState } from 'react';\nexport default function App(){ return <div>ok</div>; }\n");
  const mgr = new PreviewManager();
  try {
    const view = await mgr.start({ storagePath: store, name: "app.jsx", projectId: "1" });
    assert.equal(view.kind, "react");
    const res = await getText(view.url);
    assert.ok(res.body.includes("babel"), "babel standalone loaded");
    assert.ok(res.body.includes("createRoot"), "mount code present");
    assert.ok(!res.body.includes("import {"), "bare import stripped");
    assert.ok(res.body.includes("window.__APX_ARTIFACT__"), "default export rewired");
  } finally {
    await mgr.stopAll();
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("preview reuses the server for the same artifact + project", async () => {
  const store = tmpStore();
  write(store, "page.html", "<html><body>x</body></html>");
  const mgr = new PreviewManager();
  try {
    const a = await mgr.start({ storagePath: store, name: "page.html", projectId: "9" });
    const b = await mgr.start({ storagePath: store, name: "page.html", projectId: "9" });
    assert.equal(a.id, b.id, "same id reused, no port leak");
    assert.equal(mgr.list("9").length, 1);
    assert.equal(mgr.list("other").length, 0, "list is project-scoped");
  } finally {
    await mgr.stopAll();
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("preview static server blocks path traversal", async () => {
  const store = tmpStore();
  write(store, "page.html", "<html><body>x</body></html>");
  const mgr = new PreviewManager();
  try {
    const view = await mgr.start({ storagePath: store, name: "page.html", projectId: "1" });
    const res = await getText(view.url + "../../../../etc/passwd");
    assert.equal(res.status, 404, "escaping the artifacts root is refused");
  } finally {
    await mgr.stopAll();
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("preview errors for a missing artifact", async () => {
  const store = tmpStore();
  const mgr = new PreviewManager();
  try {
    await assert.rejects(
      () => mgr.start({ storagePath: store, name: "nope.html", projectId: "1" }),
      /not found/,
    );
  } finally {
    await mgr.stopAll();
    fs.rmSync(store, { recursive: true, force: true });
  }
});

test("detectProviders returns an array (env-dependent)", () => {
  const providers = detectProviders();
  assert.ok(Array.isArray(providers));
  for (const p of providers) assert.ok(["cloudflared", "localtunnel"].includes(p));
});
