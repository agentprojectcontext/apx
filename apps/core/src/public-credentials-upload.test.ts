import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createPublicCredentials } from "./public-credentials.ts";
import { waitFor } from "./testkit/platform.ts";
import { listenHooks } from "./transport/hooks.ts";

for (const change of ["rotate", "revoke", "remove"] as const) {
  test(`an upload authenticated before ${change} cannot deliver after it`, async () => {
    const env = await startCore({ llm: scriptedLlm(() => say("Unused")) });
    let registered = true;
    const credentials = createPublicCredentials({
      store: env.core.store,
      secrets: env.core.secrets,
      endpoints: () => (registered ? [{ path: "/flows/acme", label: "Acme" }] : []),
    });
    const issued = credentials.rotate("/flows/acme");
    const token = env.core.secrets.resolve(issued.secret_ref);
    assert.ok(token);
    let authorized = 0;
    let deliveries = 0;
    const server = await listenHooks({
      port: 0,
      log: { info() {}, warn() {}, error() {} },
      routes: credentials.protect(() => ({
        id: "acme",
        methods: ["POST"],
        authorize: (headers) => {
          assert.deepEqual(headers, { "content-type": "application/json" });
          authorized++;
          return true;
        },
        handle: async (request) => {
          assert.deepEqual(request.headers, { "content-type": "application/json" });
          deliveries++;
          return { status: 202 };
        },
      })),
    });
    const req = http.request({
      host: "127.0.0.1",
      port: server.port,
      path: "/flows/acme",
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const response = new Promise<number | undefined>((resolve, reject) => {
      req.once("error", reject);
      req.once("response", (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      });
    });
    try {
      req.write('{"work":');
      await waitFor(() => authorized === 1, "upload authorized before finishing body");
      if (change === "remove") registered = false;
      else credentials[change]("/flows/acme");
      req.end("true}");
      assert.equal(await response, 401);
      assert.equal(deliveries, 0);
      if (change === "rotate") {
        const next = credentials.reveal("/flows/acme").token;
        const accepted = await fetch(`http://127.0.0.1:${server.port}/flows/acme`, {
          method: "POST",
          headers: { authorization: `Bearer ${next}`, "content-type": "application/json" },
          body: "{}",
        });
        assert.equal(accepted.status, 202);
        await accepted.text();
        assert.equal(deliveries, 1);
      }
    } finally {
      req.destroy();
      await response.catch(() => {});
      await server.close();
      await env.core.close();
      await env.cleanup();
    }
  });
}
