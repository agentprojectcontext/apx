// A screen's viewer that drops opens again by itself: the owner never has to leave and come back (DECISIONS.md#d-152).
// The desktop is a stand-in for `nc` on the agent's VNC socket: it says the RFB handshake through the core's own
// viewer path, drops the first time, and stays the next.
import fs from "node:fs";
import path from "node:path";
import { say, scriptedLlm, startCore } from "../../apps/core/src/engine/testkit.ts";
import { createVmLifecycle } from "../../apps/core/src/environments/lifecycle.ts";
import { removeDir, tempDir } from "../../apps/core/src/testkit/platform.ts";
import { expect, test } from "./kit.ts";

/** A desktop on stdin/stdout: version, security "none", then the server's init; the first one ends after a moment. */
const DESKTOP = `#!/usr/bin/env node
const fs = require("node:fs");
const count = process.env.APX_VIEWER_COUNT;
const n = Number(fs.existsSync(count) ? fs.readFileSync(count, "utf8") : "0") + 1;
fs.writeFileSync(count, String(n));
process.stdout.write("RFB 003.008\\n");
let got = 0;
let step = 0;
process.stdin.on("data", (chunk) => {
  got += chunk.length;
  if (step === 0 && got >= 12) { step = 1; process.stdout.write(Buffer.from([1, 1])); }
  if (step === 1 && got >= 13) { step = 2; process.stdout.write(Buffer.from([0, 0, 0, 0])); }
  if (step === 2 && got >= 14) {
    step = 3;
    const init = Buffer.alloc(27);
    init.writeUInt16BE(64, 0);
    init.writeUInt16BE(64, 2);
    init.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0], 4);
    init.writeUInt32BE(3, 20);
    init.write("APX", 24);
    process.stdout.write(init);
    if (n === 1) setTimeout(() => process.exit(0), 300);
  }
});
process.stdin.on("end", () => process.exit(0));
`;

test("a viewer that drops reconnects by itself and shows the agent's screen, never the error", async ({ page }) => {
  const dir = tempDir("apx-viewer-").path;
  const desktop = path.join(dir, "desktop.cjs");
  const count = path.join(dir, "count");
  fs.writeFileSync(desktop, DESKTOP, { mode: 0o755 });
  process.env.APX_VIEWER_COUNT = count;
  const lifecycle = createVmLifecycle({
    supported: true,
    installed: () => true,
    running: async () => true,
    prepare: async () => {},
    stop: async () => {},
    appearance: async () => {},
  });
  const env = await startCore({
    llm: scriptedLlm(() => say("Listo")),
    computer: {
      limaHome: "/unused",
      instance: "missing",
      lifecycle,
      executable: () => desktop,
      env: { ...process.env, APX_VIEWER_COUNT: count },
    },
  });
  const viewers = () => Number(fs.existsSync(count) ? fs.readFileSync(count, "utf8") : "0");
  try {
    await env.client.call("setup.finish", {});
    await env.client.call("environments.permit", { agent: "roby", on: true });
    // Home stays on this Mac (DECISIONS.md#d-154): the work goes in a chat of its own.
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("environments.bind", { thread: chat.id });
    await env.client.call("threads.send", { thread: chat.id, text: "Trabajá en tu pantalla" });
    await env.settle(chat.id);

    await page.goto(`${env.core.url}/#thread=${chat.id}&panel=computer`);
    const computer = page.locator(".computer");
    await expect.poll(viewers, { timeout: 15_000 }).toBeGreaterThan(1);
    await expect(computer.locator(".computer__status.is-on")).toBeVisible();
    await expect(computer.getByText("No se pudo conectar al escritorio de la VM.")).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await env.core.close();
    env.cleanup();
    await removeDir(dir);
  }
});
