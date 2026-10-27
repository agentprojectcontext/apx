import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fakeLine } from "./channels/fake-line.test-support.ts";
import { fakeTeams } from "./channels/fake-teams.test-support.ts";
import { lineAdapter } from "./channels/line.ts";
import { teamsAdapter } from "./channels/teams.ts";
import type { HookRequest } from "./channels/types.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { nativePublicRoutes } from "./public-routes.ts";
import { manualTimers, waitFor } from "./testkit/platform.ts";
import { listenHooks, PUBLIC_DEADLINE_MS } from "./transport/hooks.ts";

for (const kind of ["line", "teams"] as const) {
  test(`${kind} public deadline cancels native work and retries deliver only once`, async () => {
    const line = await fakeLine();
    const teams = await fakeTeams();
    const person = `U${"b".repeat(32)}`;
    line.person(person, "Visitor");
    let blocked = 0;
    let cancelled = 0;
    let hold = true;
    const proxy = http.createServer(async (req, res) => {
      if (hold && (req.url?.includes("/profile/") || req.url === "/openid")) {
        blocked++;
        res.once("close", () => cancelled++);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const upstream = await fetch(`${kind === "line" ? line.api : teams.base}${req.url}`, {
        method: req.method,
        headers: {
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
        },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const llm = scriptedLlm(() => say("Unexpected model call"));
    const env = await startCore({
      llm,
      channelAdapters: {
        line: (c, s) => lineAdapter(c, s, { dir: path.join(env.home, c.id), api: base }),
        teams: (c, s) =>
          teamsAdapter(c, s, { dir: path.join(env.home, c.id), openid: `${base}/openid`, login: teams.base }),
      },
    });
    const clock = manualTimers();
    let listener: Awaited<ReturnType<typeof listenHooks>> | undefined;
    try {
      await env.client.call("webhooks.set", { mode: "custom", url: "https://acme.example" });
      await env.client.call("channels.set", {
        id: kind,
        channel: { type: kind, agent_id: "roby" },
        token: kind === "line" ? line.secret : teams.secret,
      });
      await waitFor(
        async () => (await env.client.call("channels.list", {})).channels.every((c) => c.status !== "starting"),
        "native adapter started",
      );
      listener = await listenHooks({
        port: 0,
        routes: nativePublicRoutes({ store: env.core.store, deliver: env.core.channels.webhook }),
        log: { info() {}, warn() {}, error() {} },
        timers: clock,
      });
      const url = `http://127.0.0.1:${listener.port}/hooks/${kind}`;
      const request: HookRequest =
        kind === "line" ? line.hook([line.text(person, "Hello")]) : teams.request(teams.message("visitor", "Hello"));
      const post = async () => {
        const r = await fetch(url, { method: "POST", headers: request.headers, body: new Uint8Array(request.body) });
        await r.arrayBuffer();
        return r.status;
      };
      const first = post();
      await waitFor(() => blocked === 1, "native lookup is in flight");
      const duplicate = kind === "line" ? post() : undefined;
      if (duplicate) await waitFor(() => clock.armed() >= 2, "concurrent retry reached the listener");
      clock.tick(PUBLIC_DEADLINE_MS);
      if (duplicate) assert.equal(await duplicate, 503, "an in-flight duplicate must ask the provider to retry");
      assert.equal(await first, 503);
      await waitFor(() => cancelled === 1, "deadline abort reached the native HTTP lookup");
      assert.equal(line.sent.length + teams.sentTo("visitor").length, 0, "no late pairing side effect");
      hold = false;
      const retries = await Promise.all([post(), post()]);
      assert.ok(retries.includes(200));
      assert.ok(retries.every((status) => status === 200 || (kind === "line" && status === 503)));
      assert.equal(await post(), 200);
      await waitFor(
        () => (kind === "line" ? line.sentTo(person).length === 1 : teams.sentTo("visitor").length === 1),
        "one pairing reply after retry",
      );
      assert.equal(llm.calls.length, 0);
    } finally {
      await listener?.close();
      await env.core.close();
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await line.close();
      await teams.close();
      await env.cleanup();
    }
  });
}
