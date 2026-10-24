import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { mediaData } from "../services/uploads.ts";
import { removeDir } from "../testkit/platform.ts";
import { scratchRoot } from "../tools/folders.ts";
import { claudeHarness } from "./claude.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("mobile uploads reach the Claude SDK subprocess as pixels and a temp-folder copy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-image-sdk-"));
  const capture = path.join(dir, "input.json");
  // A .js file: the SDK starts it through node on every system (a .cjs it would run as a native program).
  const bin = path.join(dir, "claude.js");
  // The real SDK starts this stand-in CLI and performs its normal stream-json handshake.
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "user") {
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(m));
    send({ type: "result", subtype: "success", result: "Image received", session_id: "fixture-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
  }
});
`,
  );
  fs.chmodSync(bin, 0o755);
  let env: Awaited<ReturnType<typeof startCore>> | undefined;
  let store: import("../domain/store.ts").Store | undefined;
  const harness = claudeHarness({
    claudePath: async () => bin,
    cwd: () => dir,
    readImage: (id) => store && mediaData(store, id),
  });
  try {
    env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude: harness } });
    store = env.core.store;
    const project = (await env.client.call("projects.register", { path: dir, init: true })).project;
    const client = env.client;
    const create = () =>
      client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project.id, engine: "claude" });
    for (const existing of [false, true]) {
      let thread: import("@apx/protocol").Thread | undefined = existing ? await create() : undefined;
      if (thread) {
        await client.call("threads.send", { thread: thread.id, text: "Hello" });
        const first = await env.settle(thread.id, 20_000);
        assert.equal(first.runs[0]?.state, "completed", JSON.stringify(first));
      }
      const { media }: { media: { id: string } } = await client.call("media.upload", {
        name: "photo.png",
        mime: "image/png",
        data: PNG,
        ...(thread ? { thread: thread.id } : {}),
      });
      thread ??= await create();
      const sent: { run?: { id: string } } = await client.call("threads.send", {
        thread: thread.id,
        text: "Describe this",
        attachments: [media.id],
      });
      const done = await env.settle(thread.id, 20_000);
      assert.equal(done.runs.find((run) => run.id === sent.run?.id)?.state, "completed", JSON.stringify(done));
      const received = JSON.parse(fs.readFileSync(capture, "utf8")) as {
        message: {
          content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>;
        };
      };
      assert.deepEqual(received.message.content.find((part) => part.type === "image")?.source, {
        type: "base64",
        media_type: "image/png",
        data: PNG,
      });
      const text = received.message.content.find((part) => part.type === "text")?.text ?? "";
      const file = /File in your temp folder: (.+)\. Use/.exec(text)?.[1];
      assert.ok(file, text);
      assert.equal(
        path.relative(path.join(scratchRoot(env.home), thread.id), file).startsWith(`attachments${path.sep}`),
        true,
      );
      assert.deepEqual(fs.readFileSync(file), Buffer.from(PNG, "base64"));
      const stored = env.core.store.media.get(media.id);
      assert.ok(stored);
      assert.notEqual(path.basename(stored.path), "photo.png");
      assert.deepEqual(fs.readFileSync(stored.path), Buffer.from(PNG, "base64"));
    }
  } finally {
    if (env) {
      await env.core.close();
      await env.cleanup();
    }
    // The SDK's process may still be leaving the folder, and Windows cannot delete a folder in use.
    await removeDir(dir);
  }
});
