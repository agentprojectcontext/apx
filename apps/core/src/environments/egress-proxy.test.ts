import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import { cachedLookup, type EgressPolicy, LOOKUP_CACHE_MS } from "./egress-policy.ts";
import { createEgressProxy, EGRESS_LIMITS } from "./egress-proxy.ts";

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

test("one pipelined HTTP client cannot bypass the global outbound connection budget", async () => {
  const target = net.createServer();
  const held = new Set<net.Socket>();
  target.on("connection", (socket) => {
    held.add(socket);
    socket.once("close", () => held.delete(socket));
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  let lookups = 0;
  let dials = 0;
  const proxy = await createEgressProxy(
    {
      ...policy,
      lookup: async () => {
        lookups++;
        return [{ address: publicIP, family: 4 }];
      },
    },
    () => {
      dials++;
      return net.connect(portOf(target), "127.0.0.1");
    },
  );
  const client = net.connect(proxy.port, "127.0.0.1");
  try {
    await once(client, "connect");
    const limit = EGRESS_LIMITS.requests;
    client.write(
      Array.from({ length: limit + 16 }, () => "GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n").join(
        "",
      ),
    );
    const deadline = Date.now() + 5000;
    while (lookups < limit) {
      assert.ok(Date.now() < deadline, "pipeline was not processed");
      await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lookups, limit);
    assert.ok(dials > 0 && dials <= limit, `outbound sockets: ${dials}`);
  } finally {
    client.destroy();
    await proxy.close();
    for (const socket of held) socket.destroy();
    await close(target);
  }
});

/** A CONNECT through the proxy to `target`, resolved once the tunnel is up. */
async function tunnel(port: number) {
  const client = net.connect(port, "127.0.0.1");
  await once(client, "connect");
  client.write("CONNECT registry.example.com:443 HTTP/1.1\r\nHost: registry.example.com:443\r\n\r\n");
  const reply = String((await once(client, "data"))[0]);
  return { client, reply };
}

test("a package manager's many parallel tunnels all open, and a long download goes through whole", async () => {
  const size = 300 * 1024 * 1024;
  const target = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      if (String(chunk) !== "big") return void socket.end(chunk);
      const block = Buffer.alloc(1024 * 1024, 7);
      let sent = 0;
      const pump = () => {
        while (sent < size) {
          sent += block.length;
          if (!socket.write(block)) return void socket.once("drain", pump);
        }
        socket.end();
      };
      pump();
    });
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const proxy = await createEgressProxy(policy, () => net.connect(portOf(target), "127.0.0.1"));
  const open: net.Socket[] = [];
  try {
    // More at once than a 64-socket budget held, which reset them.
    const many = await Promise.all(Array.from({ length: 120 }, () => tunnel(proxy.port)));
    for (const t of many) open.push(t.client);
    assert.ok(many.every((t) => /200 Connection Established/.test(t.reply)));
    const echoed = await Promise.all(
      many.map(async ({ client }, i) => {
        client.write(`ping ${i}`);
        return String((await once(client, "data"))[0]);
      }),
    );
    assert.deepEqual(
      echoed,
      many.map((_, i) => `ping ${i}`),
    );

    const { client, reply } = await tunnel(proxy.port);
    open.push(client);
    assert.match(reply, /200 Connection Established/);
    let got = 0;
    client.on("data", (chunk: Buffer) => {
      got += chunk.length;
    });
    const ended = once(client, "end");
    client.write("big");
    await ended;
    assert.equal(got, size, "past the old per-tunnel cap of 256 MiB");
  } finally {
    for (const socket of open) socket.destroy();
    await proxy.close();
    await close(target);
  }
});

test("a quiet tunnel ends after the idle limit, and past the budget a tunnel is told to retry, not reset", async () => {
  const target = net.createServer((socket) => socket.pipe(socket));
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const limits = { ...EGRESS_LIMITS, requests: 2, idleMs: 2_000 };
  const proxy = await createEgressProxy(policy, () => net.connect(portOf(target), "127.0.0.1"), limits);
  const open: net.Socket[] = [];
  try {
    const quiet = await tunnel(proxy.port);
    const other = await tunnel(proxy.port);
    open.push(quiet.client, other.client);
    const full = await tunnel(proxy.port);
    open.push(full.client);
    assert.match(full.reply, /^HTTP\/1\.1 503 .*Retry-After: 1/s);
    await once(quiet.client, "close");
  } finally {
    for (const socket of open) socket.destroy();
    await proxy.close();
    await close(target);
  }
});

test("a burst of tunnels to one name looks it up once, a failed lookup is asked again, and the cache ages out", async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const lookup = cachedLookup(
    async () => {
      calls++;
      if (fail) throw new Error("ENOTFOUND");
      return [{ address: publicIP, family: 4 }];
    },
    () => now,
  );
  await Promise.all(Array.from({ length: 50 }, () => lookup("registry.example.com")));
  assert.equal(calls, 1);
  now += LOOKUP_CACHE_MS;
  fail = true;
  await assert.rejects(lookup("registry.example.com"));
  fail = false;
  await lookup("registry.example.com");
  assert.equal(calls, 3);
});
