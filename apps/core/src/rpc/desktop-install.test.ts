import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PROTOCOL_VERSION } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import WebSocket from "ws";
import { createDesktopInstaller } from "../../../../packages/install/src/desktop.ts";
import { testConfig } from "../config.ts";
import { createCore } from "../server.ts";
import { removeDir } from "../testkit/platform.ts";

test("desktop installation is local, human-only and single-flight across HTTP and WS", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-desktop-rpc-"));
  let downloads = 0;
  const installer = createDesktopInstaller({
    platform: "linux",
    arch: "x64",
    userHome: home,
    env: { DISPLAY: ":1" },
    feed: "https://releases.example",
    candidates: [],
    fetch: async (_input, init) => {
      downloads++;
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  const core = await createCore(testConfig({ home, token: "owner-test" }), {
    quiet: true,
    desktopInstaller: installer,
  });
  const client = new ApxClient({ url: core.url, token: "owner-test" });
  const socket = await client.connect();
  const post = (method: string, headers: Record<string, string> = {}, body: unknown = {}) =>
    fetch(`${core.url}/rpc/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer owner-test",
        "idempotency-key": "same-install",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.deepEqual(await socket.call("desktop.install_status", {}), await client.call("desktop.install_status", {}));
    const start = await post("desktop.install");
    assert.equal(start.status, 200);
    assert.equal(((await start.json()) as { result: { phase: string } }).result.phase, "downloading");
    assert.equal((await socket.call("desktop.install", {})).phase, "downloading");
    assert.equal(downloads, 1);
    const forbiddenHeaders: Record<string, string>[] = [
      { "x-forwarded-for": "100.64.0.7" },
      { "x-apx-actor": "agent" },
    ];
    for (const headers of forbiddenHeaders) {
      const denied = await post("desktop.install", headers);
      assert.equal(denied.status, 401, JSON.stringify(headers));
      assert.equal(((await denied.json()) as { error: { code: string } }).error.code, "unauthorized");
    }
    const remoteHost = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${core.url}/rpc/desktop.install_status`,
        {
          method: "POST",
          headers: { host: "remote.example", authorization: "Bearer owner-test", "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    assert.equal(remoteHost, 401);
    assert.equal((await post("desktop.install_status", { "x-forwarded-for": "100.64.0.7" })).status, 401);
    assert.equal((await post("desktop.install", {}, { url: "https://outside.example/app.exe" })).status, 400);
    assert.equal(downloads, 1);

    const remote = new WebSocket(`${core.url.replace("http", "ws")}/ws?token=owner-test`, {
      headers: { "x-forwarded-for": "100.64.0.7" },
    });
    await once(remote, "open");
    remote.send(
      JSON.stringify({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        role: "operator",
        actor: "human",
        client: { name: "test", version: "0.0.0" },
        caps: [],
      }),
    );
    await once(remote, "message");
    remote.send(
      JSON.stringify({ t: "req", id: "install", method: "desktop.install", params: {}, idem: "same-install" }),
    );
    const [raw] = await once(remote, "message");
    assert.equal(JSON.parse(String(raw)).error.code, "unauthorized");
    remote.send(
      JSON.stringify({ t: "req", id: "cancel", method: "desktop.install_cancel", params: {}, idem: "cancel" }),
    );
    const [cancelRaw] = await once(remote, "message");
    assert.equal(JSON.parse(String(cancelRaw)).error.code, "unauthorized");
    remote.close();
    await once(remote, "close");
    const deniedCancel = await post("desktop.install_cancel", { "x-apx-actor": "agent" });
    assert.equal(deniedCancel.status, 401);
    assert.equal((await post("desktop.install_cancel", { "x-forwarded-for": "100.64.0.7" })).status, 401);
    const cancelled = await post("desktop.install_cancel");
    assert.equal(cancelled.status, 200);
    assert.equal(((await cancelled.json()) as { result: { phase: string } }).result.phase, "idle");
    assert.equal((await socket.call("desktop.install", {})).phase, "downloading");
    assert.equal((await socket.call("desktop.install_cancel", {})).phase, "idle");
    assert.equal(downloads, 2);
    assert.equal((await socket.call("desktop.install_status", {})).error, undefined);
  } finally {
    socket.close();
    await core.close();
    await removeDir(home);
  }
});
