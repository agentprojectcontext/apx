import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import type { EgressPolicy } from "./egress-policy.ts";
import { createEgressProxy } from "./egress-proxy.ts";

const publicIP = "93.184.216.34";
const policy: EgressPolicy = {
  lookup: async () => [{ address: publicIP, family: 4 }],
  allowed: (address) => address === publicIP,
};
const portOf = (server: net.Server) => {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
};
const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));
function request(port: number, url: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{ code: number; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: url, method: "POST", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ code: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end("payload");
  });
}

test("HTTP proxy pins the public address, preserves request content and strips proxy credentials", async () => {
  const target = http.createServer((req, res) => {
    assert.equal(req.url, "/path?q=1");
    assert.equal(req.headers.host, "example.com");
    assert.equal(req.headers["proxy-authorization"], undefined);
    assert.equal(req.headers["x-secret"], undefined);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => res.end(body));
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  let dials = 0;
  const proxy = await createEgressProxy(policy, (address, port) => {
    dials++;
    assert.equal(address, publicIP);
    assert.equal(port, 80);
    return net.connect(portOf(target), "127.0.0.1");
  });
  try {
    assert.deepEqual(
      await request(proxy.port, "http://example.com/path?q=1", {
        "proxy-authorization": "secret",
        connection: "x-secret",
        "x-secret": "private",
      }),
      { code: 200, body: "payload" },
    );
    assert.equal((await request(proxy.port, "http://127.0.0.1/private")).code, 403);
    assert.equal((await request(proxy.port, "http://[::ffff:7f00:1]/private")).code, 403);
    assert.equal(dials, 1);
  } finally {
    await proxy.close();
    await close(target);
  }
});

test("CONNECT tunnels use pinned addresses and close immediately when the policy changes", async () => {
  const target = net.createServer((socket) => socket.pipe(socket));
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  let allowed = true;
  const proxy = await createEgressProxy(
    { ...policy, allowed: (address) => allowed && policy.allowed(address) },
    (address, port) => {
      assert.equal(address, publicIP);
      assert.equal(port, 443);
      return net.connect(portOf(target), "127.0.0.1");
    },
  );
  const client = net.connect(proxy.port, "127.0.0.1");
  try {
    await once(client, "connect");
    client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    assert.match(String((await once(client, "data"))[0]), /200 Connection Established/);
    client.write("hello");
    assert.equal(String((await once(client, "data"))[0]), "hello");
    allowed = false;
    const ended = once(client, "close");
    client.write("blocked");
    await ended;
  } finally {
    client.destroy();
    await proxy.close();
    await close(target);
  }
});

test("closing during DNS lookup cannot open a late outbound connection", async () => {
  let release: ((value: { address: string; family: number }[]) => void) | undefined;
  let dials = 0;
  const proxy = await createEgressProxy(
    {
      ...policy,
      lookup: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    () => {
      dials++;
      throw new Error("late dial");
    },
  );
  const pending = request(proxy.port, "http://example.com").catch(() => undefined);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await proxy.close();
  release([{ address: publicIP, family: 4 }]);
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dials, 0);
});
