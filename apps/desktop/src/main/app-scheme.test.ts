import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const schemes: unknown[] = [];
const partitions: string[] = [];
const fetched: string[] = [];
const opened: string[] = [];
let handler: ((request: { url: string }) => Promise<Response> | Response) | undefined;
let failFetch = false;
const native = {
  app: { isPackaged: false },
  protocol: { registerSchemesAsPrivileged: (value: unknown) => schemes.push(value) },
  session: {
    fromPartition: (partition: string) => {
      partitions.push(partition);
      return {
        protocol: {
          handle: (scheme: string, next: NonNullable<typeof handler>) => {
            assert.equal(scheme, "apx-app");
            handler = next;
          },
        },
      };
    },
  },
  net: {
    fetch: async (url: string) => {
      fetched.push(url);
      if (failFetch) throw new Error("Missing file");
      return new Response("Panel", { status: 200 });
    },
  },
  shell: {
    openExternal: async (url: string) => {
      opened.push(url);
    },
  },
};
const key = Symbol.for("apx.test.scheme");
Object.assign(globalThis, { [key]: native });
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.scheme")]; export const app = n.app; export const protocol = n.protocol; export const session = n.session; export const net = n.net; export const shell = n.shell;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { registerAppScheme, serveAppScheme, webDist, FIRST_RUN_URL } = await import("./app-scheme.ts");
const { isWebUrl, openExternal } = await import("./browser/external.ts");
hook.deregister();
Reflect.deleteProperty(globalThis, key);

const root = path.resolve("test-panel");
async function request(url: string) {
  assert.ok(handler);
  return handler({ url });
}

test("local panel registers a secure fetch-capable scheme and serves the selected partition only", async () => {
  registerAppScheme();
  assert.deepEqual(schemes, [
    [{ scheme: "apx-app", privileges: { standard: true, secure: true, supportFetchAPI: true } }],
  ]);
  assert.equal(FIRST_RUN_URL, "apx-app://app/index.html?connect");
  assert.equal(webDist(path.resolve("apps/desktop/dist")), path.resolve("apps/web/dist"));
  serveAppScheme("panel-test", root);
  assert.deepEqual(partitions, ["panel-test"]);
  assert.equal((await request("apx-app://app/")).status, 200);
  assert.equal(fetched.at(-1), pathToFileURL(path.join(root, "index.html")).href);
  assert.equal(await (await request("apx-app://app/assets/a%20b.js")).text(), "Panel");
  assert.equal(fetched.at(-1), pathToFileURL(path.join(root, "assets/a b.js")).href);
});

test("local panel refuses encoded separator escapes before fetch and reports unavailable files as 404", async () => {
  serveAppScheme("panel-test", root);
  const before = fetched.length;
  assert.equal((await request("apx-app://app/..%2foutside.txt")).status, 404);
  assert.equal((await request("apx-app://app/..%2ftest-panel-neighbor/secret.txt")).status, 404);
  assert.equal(fetched.length, before);
  failFetch = true;
  try {
    const response = await request("apx-app://app/missing.js");
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found");
  } finally {
    failFetch = false;
  }
});

test("only HTTP and HTTPS links reach a browser, a mail link only the mail app; invalid input has no native effect", async () => {
  for (const value of [
    undefined,
    null,
    1,
    {},
    "",
    "relative/path",
    "file:///tmp/a",
    "javascript:alert(1)",
    "apx:settings",
  ]) {
    assert.equal(isWebUrl(value), false);
    assert.equal(await openExternal(value), false);
  }
  assert.deepEqual(opened, []);
  assert.equal(isWebUrl("mailto:user@example.com"), false);
  assert.equal(
    await openExternal("mailto:user@example.com", "firefox"),
    false,
    "a named browser never gets a mail link",
  );
  assert.equal(await openExternal("mailto:user@example.com ?x"), false);
  assert.deepEqual(opened, []);
  assert.equal(await openExternal("https://example.com/path?q=1"), true);
  assert.equal(await openExternal("http://example.com"), true);
  assert.equal(await openExternal("mailto:user@example.com?subject=Hi%20there"), true);
  assert.deepEqual(opened, [
    "https://example.com/path?q=1",
    "http://example.com",
    "mailto:user@example.com?subject=Hi%20there",
  ]);
});
