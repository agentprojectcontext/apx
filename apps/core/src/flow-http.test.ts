import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { flowHttpUrlProblem } from "./domain/flow-http-url.ts";
import { vmAddressAllowed } from "./environments/egress-policy.ts";
import { FLOW_HTTP_READ, FlowHttpError, type FlowHttpPolicy, flowHttpRequest } from "./flow-http.ts";
import { answerOutput } from "./flow-outward-steps.ts";

/** A local server that records what reached it; `reply` answers each request. */
async function server(reply: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
    });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      reply(req, res, body);
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  return {
    port,
    seen,
    close: () =>
      new Promise<void>((r) => {
        s.closeAllConnections();
        s.close(() => r());
      }),
  };
}
const only = (port: number): FlowHttpPolicy => ({
  lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  allowed: vmAddressAllowed,
  allow: (host, p) => host === "127.0.0.1" && p === port,
});
const signal = () => AbortSignal.timeout(5000);
const stage = (err: unknown) => (err instanceof FlowHttpError ? err.stage : String(err));

test("a drawn address on this computer, a private network or the metadata service is refused", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://localhost:8080/",
    "http://api.localhost/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://100.100.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://0.0.0.0/",
    "http://intranet/",
  ])
    assert.equal(flowHttpUrlProblem(url), "private", url);
  for (const url of ["ftp://example.com/", "http://user:pw@example.com/", "not a url", "file:///etc/passwd"])
    assert.equal(flowHttpUrlProblem(url), "invalid", url);
  assert.equal(flowHttpUrlProblem("https://api.example.com/?k=secret://key"), "secret");
  assert.equal(flowHttpUrlProblem("https://api.example.com/v1/enroll"), undefined);
});

test("a name with any private address is refused before anything is sent", async () => {
  let sent = 0;
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ],
    [{ address: "169.254.169.254", family: 4 }],
    [{ address: "::1", family: 6 }],
    [{ address: "fd12::1", family: 6 }],
  ]) {
    const policy: FlowHttpPolicy = { lookup: async () => addresses, allowed: vmAddressAllowed };
    const err = await flowHttpRequest(
      { method: "POST", url: "http://rebind.example/", headers: {}, body: "{}" },
      { policy, signal: signal(), onSend: () => ++sent > 0 },
    ).catch((e: unknown) => e);
    assert.equal(stage(err), "refused", JSON.stringify(addresses));
  }
  assert.equal(sent, 0, "nothing went out");
});

test("DNS rebinding: the socket goes to the address checked, never to a second answer for the name", async () => {
  const local = await server((_q, res) => res.end("inside"));
  try {
    let lookups = 0;
    // Public the first time it is asked, this computer after that: only the first answer is ever used.
    const policy: FlowHttpPolicy = {
      lookup: async () =>
        lookups++ === 0 ? [{ address: "198.51.100.7", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
      allowed: (a) => a === "198.51.100.7",
    };
    const err = await flowHttpRequest(
      { method: "GET", url: `http://rebind.example:${local.port}/`, headers: {} },
      { policy, signal: AbortSignal.timeout(400), onSend: () => true },
    ).catch((e: unknown) => e);
    assert.ok(err instanceof FlowHttpError);
    assert.equal(lookups, 1);
    assert.equal(local.seen.length, 0, "the local server was never reached");
  } finally {
    await local.close();
  }
});

test("the connected socket is checked again, and nothing is written before the step commits", async () => {
  const local = await server((_q, res) => res.end("ok"));
  try {
    let checks = 0;
    // Allowed when the name is resolved, refused once connected: the request never leaves.
    const policy: FlowHttpPolicy = {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      allowed: () => checks++ === 0,
    };
    const err = await flowHttpRequest(
      { method: "POST", url: `http://svc.example:${local.port}/`, headers: {}, body: "{}" },
      { policy, signal: signal(), onSend: () => assert.fail("must not commit") },
    ).catch((e: unknown) => e);
    assert.equal(stage(err), "refused");
    // The step said no (the run ended): nothing is written either.
    const refused = await flowHttpRequest(
      { method: "POST", url: `http://127.0.0.1:${local.port}/`, headers: {}, body: "{}" },
      { policy: only(local.port), signal: signal(), onSend: () => false },
    ).catch((e: unknown) => e);
    assert.equal(stage(refused), "unsent");
    assert.equal(local.seen.length, 0);
  } finally {
    await local.close();
  }
});

test("redirects are not followed: the 3xx and its Location are the answer", async () => {
  const inside = await server((_q, res) => res.end("secret page"));
  const edge = await server((_q, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${inside.port}/admin` });
    res.end();
  });
  try {
    const answer = await flowHttpRequest(
      { method: "GET", url: `http://127.0.0.1:${edge.port}/go`, headers: {} },
      { policy: only(edge.port), signal: signal(), onSend: () => true },
    );
    assert.equal(answer.status, 302);
    assert.equal(answer.headers.location, `http://127.0.0.1:${inside.port}/admin`);
    assert.equal(inside.seen.length, 0);
    assert.deepEqual(answerOutput(answer, []), {
      status: 302,
      ok: false,
      bytes: 0,
      truncated: false,
      location: `http://127.0.0.1:${inside.port}/admin`,
    });
  } finally {
    await inside.close();
    await edge.close();
  }
});

test("an answer is read up to its cap, binary is only said, JSON is kept as data and secrets are cut", async () => {
  const big = await server((_q, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("x".repeat(FLOW_HTTP_READ + 50_000));
  });
  try {
    const answer = await flowHttpRequest(
      { method: "GET", url: `http://127.0.0.1:${big.port}/`, headers: {} },
      { policy: only(big.port), signal: signal(), onSend: () => true },
    );
    assert.equal(answer.bytes.length, FLOW_HTTP_READ);
    assert.equal(answer.truncated, true);
    const out = answerOutput(answer, []);
    assert.equal(out.truncated, true);
    assert.equal(String(out.body).length, 16 * 1024);
  } finally {
    await big.close();
  }
  const png = answerOutput(
    {
      status: 200,
      headers: { "content-type": "image/png" },
      bytes: Buffer.from([137, 80, 78, 71, 0, 1]),
      truncated: false,
    },
    [],
  );
  assert.deepEqual(png, { status: 200, ok: true, bytes: 6, truncated: false, content_type: "image/png", binary: true });
  const nul = answerOutput(
    { status: 200, headers: { "content-type": "text/plain" }, bytes: Buffer.from("a\u0000b"), truncated: false },
    [],
  );
  assert.equal(nul.binary, true);
  const echoed = answerOutput(
    {
      status: 200,
      headers: { "content-type": "application/json" },
      bytes: Buffer.from(JSON.stringify({ price: 71240, echo: "Bearer tok-ACME-1234567" })),
      truncated: false,
    },
    ["tok-ACME-1234567"],
  );
  assert.deepEqual(echoed.json, { price: 71240, echo: "Bearer [secret]" });
  assert.equal(JSON.stringify(echoed).includes("tok-ACME"), false);
});

test("a request cut before any answer says whether it was sent", async () => {
  const hang = await server((req) => req.socket.destroy());
  try {
    const err = await flowHttpRequest(
      { method: "POST", url: `http://127.0.0.1:${hang.port}/`, headers: {}, body: "{}" },
      { policy: only(hang.port), signal: signal(), onSend: () => true },
    ).catch((e: unknown) => e);
    assert.equal(stage(err), "sent");
  } finally {
    await hang.close();
  }
  // Nothing listens: refused by the other side before anything was written.
  const err = await flowHttpRequest(
    { method: "POST", url: `http://127.0.0.1:${hang.port}/`, headers: {}, body: "{}" },
    { policy: only(hang.port), signal: signal(), onSend: () => assert.fail("never connected") },
  ).catch((e: unknown) => e);
  assert.equal(stage(err), "unsent");
});
