import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { scratchDir, scratchRoot } from "../tools/folders.ts";
import { agentFiles } from "./file-args.ts";
import { createMcp } from "./manager.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");

/** What the remote server received, decoded. */
const received: Array<Record<string, unknown>> = [];

/** A remote MCP server shaped like a social-post service: a link, a path on its own disk, or the bytes. */
function postsServer(): McpServer {
  const server = new McpServer({ name: "posts", version: "1.0.0" });
  server.registerTool(
    "upload_media",
    {
      description: "Upload an image or video to a post",
      inputSchema: {
        url: z.string().optional().describe("Public http(s) URL, preferred for video (up to 100 MB)"),
        path: z.string().optional().describe("Local path, only when the server runs on the same machine"),
        base64: z.string().optional().describe("Base64 file contents, images under 8 MB only"),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (a) => {
      received.push(a);
      const bytes = Buffer.from(a.base64 ?? "", "base64");
      return { content: [{ type: "text", text: `stored ${a.file_name} ${a.mime_type} ${bytes.length} bytes` }] };
    },
  );
  server.registerTool(
    "describe_image",
    {
      description: "Describe an image",
      inputSchema: { base64: z.string().describe("Base64 image") },
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: "a slide" }] }),
  );
  return server;
}

const remote = http.createServer(async (req, res) => {
  const server = postsServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  let body = "";
  for await (const chunk of req) body += chunk;
  await server.connect(transport);
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
});

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 400)}`);
  const id = /med_[0-9a-f]{16}/.exec(said)?.[0] ?? "";
  if (said.startsWith("upload"))
    return callTool("u1", "mcp_call", { tool: "mcp_posts_upload_media", args: { base64: id } });
  if (said.startsWith("by path"))
    return callTool("u2", "mcp_call", { tool: "mcp_posts_upload_media", args: { path: id } });
  if (said.startsWith("save")) return callTool("w1", "file_write", { path: said.split(" ")[2] ?? "", media: id });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  await new Promise<void>((r) => remote.listen(0, "127.0.0.1", r));
  env = await startCore({ llm });
  const { port } = remote.address() as AddressInfo;
  await env.client.call("mcp.set", { name: "posts", server: { url: `http://127.0.0.1:${port}/mcp` } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  remote.close();
});

/** A chat with a drawing kept in it, as make_image leaves one. */
async function chatWithImage() {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const { media } = await env.client.call("media.upload", {
    name: "slide-1.png",
    mime: "image/png",
    data: PNG.toString("base64"),
    thread: thread.id,
  });
  return { thread, media };
}
const send = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  return env.settle(thread, 15_000);
};

test("an agent sends a kept image to a remote MCP server's base64 field, and the step keeps only the reference", async () => {
  const { thread, media } = await chatWithImage();
  const r = await send(thread.id, `upload ${media.id}`);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /stored slide-1.png image\/png 24 bytes/);
  const got = received.at(-1);
  assert.deepEqual(Buffer.from(String(got?.base64), "base64"), PNG);
  assert.equal(got?.path, undefined);
  // Persisted arguments hold the media id, never the bytes.
  const steps = env.core.store.runs.steps(r.runs[0]?.id ?? "");
  assert.ok(JSON.stringify(steps).includes(media.id));
  assert.ok(!JSON.stringify(steps).includes(PNG.toString("base64")));
});

test("a drawing of several MB goes whole: the bytes join after every check, the step stays small", async () => {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]);
  const { media } = await env.client.call("media.upload", {
    name: "slide-2.png",
    mime: "image/png",
    data: big.toString("base64"),
    thread: thread.id,
  });
  const r = await send(thread.id, `upload ${media.id}`);
  assert.deepEqual(Buffer.from(String(received.at(-1)?.base64), "base64"), big);
  assert.ok(JSON.stringify(env.core.store.runs.steps(r.runs[0]?.id ?? "")).length < 10_000);
});

test("a path field of a remote server is refused with the field to use, and nothing reaches the server", async () => {
  const { thread, media } = await chatWithImage();
  const before = received.length;
  await send(thread.id, `by path ${media.id}`);
  assert.match(
    String(llm.calls.at(-1)?.messages.at(-1)?.content),
    /path is read by the server, which runs elsewhere.*give the file in base64 instead/,
  );
  assert.equal(received.length, before);
});

test("an agent copies a kept image into its temp folder as a file", async () => {
  const { thread, media } = await chatWithImage();
  const folder = scratchDir(env.core.store, env.home, thread);
  const target = `${folder}/slides/slide-1.png`;
  await send(thread.id, `save ${media.id} ${target}`);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /created .*slide-1.png from med_/);
  assert.deepEqual(fs.readFileSync(target), PNG);
  // Another chat's media is not this one's to copy.
  const other = await chatWithImage();
  await send(thread.id, `save ${other.media.id} ${folder}/stolen.png`);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /is not a file of this chat/);
  assert.equal(fs.existsSync(`${folder}/stolen.png`), false);
});

test("a tool that only reads still waits for the owner, while outside content is in the turn, when it carries a file", async () => {
  const { thread } = await chatWithImage();
  const mcp = createMcp({
    store: env.core.store,
    secrets: env.core.secrets,
    log: createLog("test", true),
    workDir: path.join(scratchRoot(env.home), "mcp"),
    files: (t) => agentFiles(env.core.store, env.home, t),
  });
  try {
    const t = env.core.store.threads.get(thread.id);
    const agent = env.core.store.agents.get("roby");
    assert.ok(t && agent);
    const tool = (await mcp.toolsFor(t)).find((x) => x.name === "mcp_posts_describe_image");
    assert.ok(tool);
    assert.equal(tool.confirm({ base64: "aGVsbG8=" }), "never");
    assert.equal(tool.confirm({ base64: "med_0123456789abcdef" }), "untrusted");
    // The schema's own check does not trip on the reference, and a reference to nothing stops before anyone is asked.
    assert.equal(tool.parse({ base64: "apx-file:missing.png" }).ok, true);
    assert.throws(
      () => tool.check?.({ base64: "apx-file:missing.png" }, { agent, thread: { ...t, reach: "card" } }),
      /does not exist/,
    );
  } finally {
    await mcp.close();
  }
});
