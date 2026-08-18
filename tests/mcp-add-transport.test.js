// `apx mcp add` — transport routing (stdio vs remote http).
//
// Regression guard for the gap that made agents invent flags: the daemon API,
// the store, the runner and the web UI all spoke http (url + headers), but the
// CLI hard-required --command and never sent url/headers. There was no way to
// register a remote MCP from the terminal, so an agent asked to "add this MCP"
// tried --transport/--url/--header, got "--command required", and went off to
// read the source instead of registering the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-add-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { http } = await import("#interfaces/cli/http.js");
const { cmdMcpAdd, cmdMcpEnable } = await import("#interfaces/cli/commands/mcp.js");

// Stub the daemon. Returns the captured POST bodies; `listed` is what
// GET /mcps reports (used by enable/disable to find the owning scope).
function installStub(listed = []) {
  const posts = [];
  http.get = async (p) => (p.endsWith("/mcps") ? listed : {});
  http.post = async (p, body) => {
    posts.push([p, body]);
    return { name: body.name };
  };
  return posts;
}

const origGet = http.get;
const origPost = http.post;
const silence = () => {
  const orig = console.log;
  console.log = () => {};
  return () => (console.log = orig);
};

// args as cli/index.js parseArgs would produce them. A flag repeated on the
// command line arrives as an array; given once, as a bare string.
const argv = (positional, flags) => ({ _: positional, flags: { project: "7", ...flags } });

test("stdio: --command still writes command/args/env and no url", async () => {
  const posts = installStub();
  const restore = silence();
  try {
    await cmdMcpAdd(argv(["filesystem", "-y", "@modelcontextprotocol/server-filesystem", "."], {
      command: "npx",
      env: "FOO=bar",
      scope: "shared",
    }));
  } finally {
    restore();
  }
  const [url, body] = posts[0];
  assert.equal(url, "/api/projects/7/mcps?scope=shared");
  assert.equal(body.command, "npx");
  assert.deepEqual(body.args, ["-y", "@modelcontextprotocol/server-filesystem", "."]);
  assert.deepEqual(body.env, { FOO: "bar" });
  assert.equal(body.url, undefined);
  assert.equal(body.enabled, true);
});

test("http: --url alone registers a remote server", async () => {
  const posts = installStub();
  const restore = silence();
  try {
    await cmdMcpAdd(argv(["postbean"], { url: "https://mcp.example.com/mcp", scope: "runtime" }));
  } finally {
    restore();
  }
  const [route, body] = posts[0];
  assert.equal(route, "/api/projects/7/mcps?scope=runtime");
  assert.equal(body.url, "https://mcp.example.com/mcp");
  // stdio-only keys must not leak into an http entry
  assert.equal(body.command, undefined);
  assert.equal(body.args, undefined);
  assert.equal(body.env, undefined);
});

test("http: repeated --header parses both 'Name: value' and Name=value", async () => {
  const posts = installStub();
  const restore = silence();
  try {
    await cmdMcpAdd(argv(["postbean"], {
      url: "https://mcp.example.com/mcp",
      header: ["Authorization: Bearer abc.def=ghi", "X-Workspace=acme"],
      scope: "runtime",
    }));
  } finally {
    restore();
  }
  // The bearer token contains '=' and the second header contains no ':' —
  // splitting on a single fixed separator would mangle one of the two.
  assert.deepEqual(posts[0][1].headers, {
    Authorization: "Bearer abc.def=ghi",
    "X-Workspace": "acme",
  });
});

test("http: --transport http is accepted as explicit sugar", async () => {
  const posts = installStub();
  const restore = silence();
  try {
    await cmdMcpAdd(argv(["postbean"], {
      transport: "http",
      url: "https://mcp.example.com/mcp",
      scope: "global",
    }));
  } finally {
    restore();
  }
  assert.equal(posts[0][1].url, "https://mcp.example.com/mcp");
});

test("rejects contradictory or incomplete transports with an actionable message", async () => {
  installStub();
  await assert.rejects(
    () => cmdMcpAdd(argv(["x"], { command: "npx", url: "https://e/mcp" })),
    /either --command .* or --url/
  );
  await assert.rejects(
    () => cmdMcpAdd(argv(["x"], { transport: "http" })),
    /--transport http requires --url/
  );
  await assert.rejects(
    () => cmdMcpAdd(argv(["x"], { transport: "grpc", url: "https://e/mcp" })),
    /unknown --transport/
  );
  await assert.rejects(
    () => cmdMcpAdd(argv(["x"], { command: "npx", header: "A: b" })),
    /--header only applies to an http server/
  );
  // The "nothing given" error has to point at both transports, not just stdio.
  await assert.rejects(() => cmdMcpAdd(argv(["x"], {})), /--command required.*--url/s);
});

test("enable re-posts url/headers for an http MCP, never a null command", async () => {
  const posts = installStub([
    {
      name: "postbean",
      source: "runtime",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
      enabled: false,
    },
  ]);
  const restore = silence();
  try {
    await cmdMcpEnable(argv(["postbean"], {}));
  } finally {
    restore();
  }
  const body = posts[0][1];
  assert.equal(body.url, "https://mcp.example.com/mcp");
  assert.deepEqual(body.headers, { Authorization: "Bearer x" });
  assert.equal(body.enabled, true);
  assert.ok(!("command" in body), "http entry must not gain a stdio command key");
});

test.after(() => {
  http.get = origGet;
  http.post = origPost;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
