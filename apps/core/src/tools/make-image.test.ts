import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** An OpenAI-compatible image API that keeps what each call sent. */
const calls: Array<{ path: string; type: string; body: Buffer }> = [];
const api = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    calls.push({ path: req.url ?? "", type: String(req.headers["content-type"]), body: Buffer.concat(chunks) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
  });
});

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  return callTool("d1", "make_image", { prompt: "a carousel cover", references: JSON.parse(said) });
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  env = await startCore({ llm });
  fs.mkdirSync(path.join(env.home, "work"), { recursive: true });
  await env.client.call("services.set", {
    id: "gpt",
    service: {
      kind: "image",
      dialect: "openai-images",
      label: "OpenAI",
      base_url: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
      model: "gpt-image-1",
      enabled: true,
      needs_key: false,
    },
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  api.close();
});

async function draw(references: string[]) {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "Carousel" });
  await env.client.call("threads.send", { thread: thread.id, text: JSON.stringify(references) });
  const result = await env.settle(thread.id);
  return { thread, reply: String(result.messages.at(-1)?.parts.find((p) => p.type === "text")?.text ?? "") };
}

test("make_image draws from a file in the work folder and from an earlier drawing of the same chat", async () => {
  fs.writeFileSync(path.join(env.home, "work", "reel-shot.png"), PNG);
  const first = await draw(["reel-shot.png"]);
  const edit = calls.at(-1);
  assert.equal(edit?.path, "/v1/images/edits");
  assert.match(String(edit?.type), /multipart\/form-data/);
  assert.ok(edit?.body.includes(PNG), "the reference's bytes reach the service");
  const drawn = /\((med_[0-9a-f]{16})\)/.exec(first.reply)?.[1];
  assert.ok(drawn, first.reply);

  // The id it got back works as a reference in that chat, not in another one.
  const thread = first.thread;
  await env.client.call("threads.send", { thread: thread.id, text: JSON.stringify([drawn]) });
  const again = await env.settle(thread.id);
  assert.match(String(again.messages.at(-1)?.parts.find((p) => p.type === "text")?.text), /image\(s\) shown/);
  const other = await draw([drawn]);
  assert.match(other.reply, /not an image in this chat/);
});

test("without references it asks the generations endpoint", async () => {
  await draw([]);
  assert.equal(calls.at(-1)?.path, "/v1/images/generations");
});
