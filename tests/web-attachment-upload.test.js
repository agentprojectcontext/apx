// Files sent FROM the web composer: POST /media/upload, and what a turn does
// with the path it gets back.
//
// The read side (a Telegram photo coming back as a photo) is covered by
// channel-attachments.test.js. This is the write side: the browser hands over
// bytes, the daemon decides whether it is willing to keep them, and the turn
// that names the file must resolve it inside the media dir — never outside.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point APX_HOME at a throwaway dir BEFORE importing anything that reads it:
// uploads land in <APX_HOME>/media/web, and the user's real one is not a test
// fixture.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-upload-test-"));
process.env.APX_HOME = TMP_HOME;
// Stored paths come back resolved, and on macOS the temp dir lives behind the
// /var → /private/var symlink: compare against the real one.
const MEDIA_WEB = path.join(fs.realpathSync(TMP_HOME), "media", "web");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { readTurnAttachments } = await import("#host/daemon/api/media.js");
const { mediaFromMeta } = await import("#core/stores/messages.js");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

async function listen() {
  const projects = new ProjectManager({});
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { name: "apx" } },
    token: "", // empty token → the auth middleware accepts any request
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function upload(baseUrl, name, body) {
  return fetch(`${baseUrl}/api/media/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });
}

test("an uploaded image lands in the media dir and streams back", async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await upload(baseUrl, "captura de pantalla.png", PNG);
    assert.equal(res.status, 201);
    const out = await res.json();

    assert.equal(out.kind, "photo", "the composer needs the kind to render it");
    assert.equal(out.mime, "image/png", "derived from the extension, not the request");
    assert.equal(out.size, PNG.length);
    assert.equal(out.name, "captura de pantalla.png", "the name the sender saw survives");
    assert.ok(
      out.path.startsWith(MEDIA_WEB + path.sep),
      `stored under the media dir, got ${out.path}`,
    );
    assert.notEqual(path.basename(out.path), out.name, "the stored name is ours, not the caller's");

    // The same path is what the viewer reads back through GET /media.
    const back = await fetch(`${baseUrl}/api/media?path=${encodeURIComponent(out.path)}`);
    assert.equal(back.status, 200);
    assert.equal(back.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await back.arrayBuffer()).length, PNG.length);
  } finally {
    server.close();
  }
});

test("a type outside the allowlist is refused", async () => {
  const { server, baseUrl } = await listen();
  try {
    for (const name of ["payload.sh", "installer.exe", "page.html", "noextension"]) {
      const res = await upload(baseUrl, name, Buffer.from("#!/bin/sh\necho hi\n"));
      assert.equal(res.status, 415, `${name} must not be storable`);
    }
  } finally {
    server.close();
  }
});

test("an extension the bytes do not back is refused", async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await upload(baseUrl, "actually-a-script.png", Buffer.from("<script>alert(1)</script>"));
    assert.equal(res.status, 415, "a .png must start like a .png");
  } finally {
    server.close();
  }
});

test("a name that tries to walk out of the media dir cannot", async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await upload(baseUrl, "../../../../etc/apx-escaped.png", PNG);
    assert.equal(res.status, 201, "the traversal is stripped, not an error");
    const { path: stored } = await res.json();
    assert.ok(
      stored.startsWith(MEDIA_WEB + path.sep),
      `must stay inside the media dir, got ${stored}`,
    );
    assert.equal(fs.existsSync("/etc/apx-escaped.png"), false);
  } finally {
    server.close();
  }
});

test("an upload over the cap is refused as JSON, not an HTML error page", async () => {
  const { server, baseUrl } = await listen();
  try {
    const res = await upload(baseUrl, "huge.png", Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]));
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /too large/i, "a fetch caller must be able to read the reason");
  } finally {
    server.close();
  }
});

test("a turn resolves its files inside the media dir and nowhere else", async () => {
  const { server, baseUrl } = await listen();
  try {
    const image = await (await upload(baseUrl, "foto.png", PNG)).json();
    const doc = await (await upload(baseUrl, "notas.md", Buffer.from("# notas\n"))).json();

    const fromImage = readTurnAttachments([{ path: image.path, name: image.name }]);
    assert.equal(fromImage.attachments.length, 1, "the pixels ride on the turn");
    assert.equal(fromImage.attachments[0].kind, "image");
    assert.equal(fromImage.attachments[0].mime, "image/png");
    assert.equal(
      Buffer.from(fromImage.attachments[0].data, "base64").length,
      PNG.length,
      "base64 of the real file",
    );
    assert.match(fromImage.markers[0], /^\[image attached — saved to /, "the marker names the path");
    assert.equal(fromImage.media.media_kind, "photo");
    assert.equal(fromImage.media.local_path, image.path);

    const fromDoc = readTurnAttachments([{ path: doc.path, name: doc.name }]);
    assert.equal(fromDoc.attachments.length, 0, "only images go to the model as content");
    assert.match(fromDoc.markers[0], /file attached: notas\.md/);
    assert.match(fromDoc.markers[0], /file tools/, "the agent is told how to open it");
    assert.equal(fromDoc.media.media_kind, "document");

    // A path the caller made up is dropped: no read, no marker, no turn.
    const outside = readTurnAttachments([
      { path: "/etc/hosts" },
      { path: path.join(TMP_HOME, "media", "..", "config.json") },
      { path: "" },
    ]);
    assert.deepEqual(outside, { attachments: [], markers: [], media: null });
  } finally {
    server.close();
  }
});

test("a web-uploaded turn reads back as an attachment, with no Telegram file id", () => {
  // The ledger row a web turn writes has a local_path and no file_id: gating on
  // the id would have shown the marker text instead of the file.
  const media = mediaFromMeta({
    media_kind: "photo",
    local_path: path.join(TMP_HOME, "media", "web", "abc-foto.png"),
    file_name: "foto.png",
    mime_type: "image/png",
    file_size: 1234,
  });
  assert.equal(media.kind, "photo");
  assert.equal(media.name, "foto.png");
  assert.equal(media.size, 1234);
  assert.equal(mediaFromMeta({ project_id: "3" }), null, "a typed message still carries nothing");
});
