import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { ToolApproval } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { chromium } from "@playwright/test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { RUNS_SCRIPTS, tempDir, waitFor } from "../testkit/platform.ts";
import { vmBrowserDriver } from "../testkit/vm-browser-driver.ts";

// Portable: the VM's script transport runs on macOS/Linux; Windows does not run this guest driver.
if (RUNS_SCRIPTS && fs.existsSync(chromium.executablePath())) {
  for (const scope of ["tab", "turn"] as const) {
    for (const change of ["unchanged", "closure", "reload", "owner takeover", "closure after activation"] as const) {
      test(`VM ${scope} consent respects ${change} before its successful result returns`, async () => {
        const dir = tempDir("apx-vm-browser-consent-");
        let held: ServerResponse | undefined;
        const server = http.createServer((req, res) => {
          if (req.url === "/held") {
            held = res;
            return;
          }
          res.setHeader("Content-Type", "text/html");
          res.end("<title>Example</title><h1>Example</h1>");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const driver = vmBrowserDriver(dir.path, chromium.executablePath(), `${origin}/held`);
        let thread = "";
        let run = "";
        let tab = "";
        let document = "";
        let trace = "";
        let active: ToolApproval[] = [];
        let activated = false;
        let finish: () => void = () => {};
        const afterActivation = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const env = await startCore({
          computer: { limaHome: dir.path, instance: "computer", executable: () => driver.binary },
          llm: scriptedLlm(async (req) => {
            const results = req.messages.filter((message) => message.role === "tool");
            if (!results.length) {
              const current = env.core.store.runs.list(thread).find((item) => item.state === "working");
              assert.ok(current);
              run = current.id;
              // A host turn can move onto Computer after its tools were selected.
              await env.client.call("environments.bind", { thread });
              await env.core.computer.claim("roby", thread, run);
              const browser = env.core.computer.browser(run);
              const opened = (await browser.handle("browser.open", {
                url: `${origin}/`,
                profile: "shared",
                by: "roby",
              })) as { tab: string };
              tab = opened.tab;
              const snapshot = (await browser.handle("browser.snapshot", { tab, max_chars: 1000 })) as {
                document: string;
              };
              document = snapshot.document;
            } else {
              trace = JSON.stringify(results);
              active = env.core.store.approvals.list(thread).filter((grant) => !!grant.browser);
              if (change === "closure after activation") {
                activated = true;
                await afterActivation;
              }
              if (change !== "unchanged" || results.length >= 3) return say("Done");
            }
            return callTool(`js${results.length}`, "browser_evaluate", { tab, document, origin, script: "42" });
          }),
        });
        const desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
        desktop.onRequest(async () => ({ tabs: [] }));
        try {
          await env.client.call("environments.permit", { agent: "roby", on: true });
          thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
          await env.client.call("threads.send", { thread, text: "Evaluate the page" });
          const card = await waitFor(async () => {
            const current = env.core.store.runs.list(thread)[0];
            if (current && ["completed", "failed", "cancelled"].includes(current.state))
              throw new Error(
                `VM turn ended before approval: ${JSON.stringify(current)} ${JSON.stringify((await env.client.call("threads.get", { thread })).messages)}`,
              );
            return (await env.client.call("runs.pending", { thread })).inputs[0];
          }, "a VM browser approval");
          await env.client.call("runs.respond", { input: card.id, decision: "approve", scope });
          const response = await waitFor(() => held, "the successfully executed result held in transit");
          if (change === "closure") await env.core.computer.browser(run).handle("browser.close", { tab });
          if (change === "reload")
            await env.core.computer.browser(run).handle("browser.history", { tab, action: "reload", by: "roby" });
          if (change === "owner takeover") {
            const claim = env.core.computer.ledger.forRun(run);
            assert.ok(claim);
            await env.core.computer.control(claim.screen, "human", () => 0);
          }
          response.end("Continue");
          if (change === "closure after activation") {
            await waitFor(() => activated, "the first consent to become active");
            assert.equal(
              (await env.client.call("tools.approvals", { thread })).approvals.filter((grant) => !!grant.browser)
                .length,
              1,
            );
            await env.core.computer.browser(run).handle("browser.close", { tab });
            assert.equal(
              (await env.client.call("tools.approvals", { thread })).approvals.filter((grant) => !!grant.browser)
                .length,
              scope === "turn" ? 1 : 0,
            );
            finish();
          }
          const result = await env.settle(thread);
          assert.match(trace, /42/);
          assert.doesNotMatch(trace, /not executed|not run|declined|unavailable:/i);
          assert.equal(
            active.length,
            scope === "turn" || change === "unchanged" || change === "closure after activation" ? 1 : 0,
          );
          const confirmations = result.messages
            .flatMap((message) => message.parts)
            .filter((part) => part.type === "input");
          assert.equal(confirmations.length, 1);
          if (change === "unchanged")
            assert.equal(
              result.messages
                .flatMap((message) => message.parts)
                .filter((part) => part.type === "tool" && part.tool === "browser_evaluate").length,
              3,
            );
          assert.equal(
            (await env.client.call("tools.approvals", { thread })).approvals.filter((grant) => !!grant.browser).length,
            0,
            "VM consent ends with the run",
          );
        } finally {
          held?.end("Stop");
          finish();
          desktop.close();
          await desktop.closed;
          await env.core.close();
          await driver.closed();
          await env.cleanup();
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
          await dir.remove();
        }
      });
    }
  }
}
