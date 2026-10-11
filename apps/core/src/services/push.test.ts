import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createPush } from "./push.ts";

test("an ntfy notice keeps its title in any language and opens its chat in APX when tapped", async (t) => {
  const got: Array<{ headers: IncomingHttpHeaders; body: string }> = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      got.push({ headers: req.headers, body });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/apx-topic`;
  const push = createPush({ expoUrl: "http://127.0.0.1:1/unused" });

  assert.equal(
    await push(
      { kind: "unifiedpush", endpoint },
      { title: "Terminó: ñandú", body: "Listo", data: { thread_id: "th 1" } },
    ),
    true,
  );
  assert.equal(await push({ kind: "unifiedpush", endpoint }, { title: "APX", body: "Hola" }), true);

  const [first, second] = got;
  const title = /^=\?UTF-8\?B\?(.+)\?=$/.exec(String(first?.headers.title))?.[1] ?? "";
  assert.equal(Buffer.from(title, "base64").toString("utf8"), "Terminó: ñandú");
  assert.equal(first?.headers.click, "apx://open?t=th%201");
  assert.equal(first?.body, "Listo");
  assert.equal(second?.headers.click, "apx://open");
});
