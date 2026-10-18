import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { discordAdapter } from "./discord.ts";
import { slackAdapter } from "./slack.ts";
import { type ChannelConfig, type OutFile, SendError } from "./types.ts";

type Received = { route: string; headers: http.IncomingHttpHeaders; data: Buffer };
async function endpoint(reply: (request: Received, response: http.ServerResponse) => void) {
  const received: Received[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const entry = { route: request.url ?? "", headers: request.headers, data: Buffer.concat(chunks) };
    received.push(entry);
    reply(entry, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
function json(response: http.ServerResponse, body: object, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
const config = (type: "discord" | "slack"): ChannelConfig => ({
  id: "media",
  type,
  label: "Media",
  enabled: true,
  agent_id: "roby",
  strangers: "pair",
  concurrency: "steer",
  owner_thread: "home",
});
const file: OutFile = {
  kind: "file",
  mime: "application/octet-stream",
  name: "report.bin",
  data: Buffer.from([0, 255, 13, 10, 42]),
};

test("Discord uploads exact binary bytes and attachment metadata after the caption", async (t) => {
  const remote = await endpoint((_request, response) => json(response, { id: "sent-file" }));
  t.after(remote.close);
  const adapter = discordAdapter(config("discord"), "test-token", {
    api: remote.url,
    cdn: remote.url,
    gateway: remote.url,
  });
  t.after(() => adapter.stop());
  assert.deepEqual(await adapter.send("room", { text: "Report" }, [file]), { external_id: "sent-file" });
  assert.equal(remote.received.length, 2);
  const [caption, upload] = remote.received;
  assert.ok(caption && upload);
  assert.equal(caption.route, "/channels/room/messages");
  assert.equal(JSON.parse(caption.data.toString()).content, "Report");
  assert.equal(upload.headers.authorization, "Bot test-token");
  const form = await new Response(new Uint8Array(upload.data), {
    headers: { "content-type": String(upload.headers["content-type"]) },
  }).formData();
  assert.deepEqual(JSON.parse(String(form.get("payload_json"))), { attachments: [{ id: 0, filename: "report.bin" }] });
  const attachment = form.get("files[0]");
  assert.ok(attachment instanceof File);
  assert.equal(attachment.name, "report.bin");
  assert.equal(attachment.type, file.mime);
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), file.data);
});

test("Discord rate-limited uploads report delivered parts and resume without repeating the caption", async (t) => {
  let limited = true;
  const remote = await endpoint((request, response) => {
    if (limited && String(request.headers["content-type"]).startsWith("multipart/")) {
      limited = false;
      return json(response, { message: "Slow down", retry_after: 2 }, 429);
    }
    json(response, { id: "delivered" });
  });
  t.after(remote.close);
  const adapter = discordAdapter(config("discord"), "test-token", {
    api: remote.url,
    cdn: remote.url,
    gateway: remote.url,
  });
  t.after(() => adapter.stop());
  await assert.rejects(adapter.send("room", { text: "Report" }, [file]), (error) => {
    assert.ok(error instanceof SendError);
    assert.equal(error.kind, "retry");
    assert.equal(error.retryAfterMs, 2000);
    assert.equal(error.sentParts, 1);
    return true;
  });
  assert.deepEqual(await adapter.send("room", { text: "Report", skip: 1 }, [file]), { external_id: "delivered" });
  assert.equal(
    remote.received.filter((r) => String(r.headers["content-type"]).startsWith("application/json")).length,
    1,
  );
  assert.equal(remote.received.length, 3);
});

test("Discord avatar returns image bytes, hides missing photos and tolerates a removed CDN image", async (t) => {
  const image = Buffer.from([137, 80, 78, 71]);
  const remote = await endpoint((request, response) => {
    if (request.route.startsWith("/users/"))
      return json(response, { id: request.route.slice(7), avatar: request.route.endsWith("private") ? null : "photo" });
    if (request.route.includes("removed")) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "image/png" });
    response.end(image);
  });
  t.after(remote.close);
  const adapter = discordAdapter(config("discord"), "test-token", {
    api: remote.url,
    cdn: remote.url,
    gateway: remote.url,
  });
  t.after(() => adapter.stop());
  assert.ok(adapter.avatar);
  assert.deepEqual(await adapter.avatar("visible"), { mime: "image/png", data: image });
  assert.equal(await adapter.avatar("private"), undefined);
  assert.equal(await adapter.avatar("removed"), undefined);
  assert.deepEqual(
    remote.received.map((r) => r.route),
    [
      "/users/visible",
      "/avatars/visible/photo.png?size=128",
      "/users/private",
      "/users/removed",
      "/avatars/removed/photo.png?size=128",
    ],
  );
});

test("Slack uploads bytes before publishing the file to its destination", async (t) => {
  const remote = await endpoint((request, response) => {
    if (request.route === "/files.getUploadURLExternal")
      return json(response, { ok: true, upload_url: `${remote.url}/upload`, file_id: "file-1" });
    if (request.route === "/upload") {
      response.end("OK");
      return;
    }
    json(response, { ok: true });
  });
  t.after(remote.close);
  const adapter = slackAdapter(config("slack"), "xoxb-test xapp-test", remote.url);
  t.after(() => adapter.stop());
  assert.deepEqual(await adapter.send("room", { text: "" }, [file]), { external_id: "file-1" });
  assert.deepEqual(
    remote.received.map((r) => r.route),
    ["/files.getUploadURLExternal", "/upload", "/files.completeUploadExternal"],
  );
  const [prepare, upload, complete] = remote.received;
  assert.ok(prepare && upload && complete);
  assert.deepEqual(JSON.parse(prepare.data.toString()), { filename: "report.bin", length: file.data.length });
  assert.equal(prepare.headers.authorization, "Bearer xoxb-test");
  assert.deepEqual(upload.data, file.data);
  assert.equal(upload.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(complete.data.toString()), {
    files: [{ id: "file-1", title: "report.bin" }],
    channel_id: "room",
  });
});

test("Slack failed upload never publishes a file and reports uncertain delivery", async (t) => {
  const remote = await endpoint((request, response) => {
    if (request.route === "/files.getUploadURLExternal")
      return json(response, { ok: true, upload_url: `${remote.url}/upload`, file_id: "file-1" });
    response.writeHead(503);
    response.end("Unavailable");
  });
  t.after(remote.close);
  const adapter = slackAdapter(config("slack"), "xoxb-test xapp-test", remote.url);
  t.after(() => adapter.stop());
  await assert.rejects(adapter.send("room", { text: "" }, [file]), (error) => {
    assert.ok(error instanceof SendError);
    assert.equal(error.kind, "uncertain");
    assert.match(error.message, /503/);
    return true;
  });
  assert.deepEqual(
    remote.received.map((r) => r.route),
    ["/files.getUploadURLExternal", "/upload"],
  );
});

test("Slack avatar keeps the CDN MIME and bytes and returns no image for hidden or removed photos", async (t) => {
  const image = Buffer.from([255, 216, 255]);
  const remote = await endpoint((request, response) => {
    if (request.route === "/users.info") {
      const { user } = JSON.parse(request.data.toString());
      return json(response, {
        ok: true,
        user: { profile: user === "hidden" ? {} : { image_192: `${remote.url}/${user}` } },
      });
    }
    response.writeHead(request.route === "/removed" ? 404 : 200, { "content-type": "image/jpeg" });
    response.end(image);
  });
  t.after(remote.close);
  const adapter = slackAdapter(config("slack"), "xoxb-test xapp-test", remote.url);
  t.after(() => adapter.stop());
  assert.ok(adapter.avatar);
  assert.deepEqual(await adapter.avatar("visible"), { mime: "image/jpeg", data: image });
  assert.equal(await adapter.avatar("hidden"), undefined);
  assert.equal(await adapter.avatar("removed"), undefined);
  assert.deepEqual(
    remote.received.filter((r) => r.route !== "/users.info").map((r) => r.route),
    ["/visible", "/removed"],
  );
});
