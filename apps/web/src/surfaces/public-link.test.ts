import assert from "node:assert/strict";
import { test } from "node:test";
import { openPublicLink, publicLink } from "./public-link.ts";

test("public links require a configured tunnel, never a private host fallback", () => {
  assert.throws(() => publicLink("/a/example", {}), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: null }), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: "https://public.example.com", mode: "off" }), /unavailable/);
  assert.throws(() => publicLink("/a/example", { url: "https://public.example.com", error: "failed" }), /unavailable/);
  assert.equal(publicLink("/a/example", { url: "https://public.example.com" }), "https://public.example.com/a/example");
});

test("public open reserves a tab synchronously before discovery and then navigates", async () => {
  const events: string[] = [];
  let resolve: ((url: string) => void) | undefined;
  const loaded = new Promise<string>((done) => {
    resolve = done;
  });
  const result = openPublicLink(
    () => {
      events.push("load");
      return loaded;
    },
    () => {
      events.push("open");
      return { navigate: (url) => events.push(url), close: () => events.push("close") };
    },
  );
  assert.deepEqual(events, ["open", "load"]);
  resolve?.("https://public.example.com/a/example");
  await result;
  assert.deepEqual(events, ["open", "load", "https://public.example.com/a/example"]);
});

test("failed public discovery closes its reserved tab without navigating", async () => {
  const events: string[] = [];
  await assert.rejects(
    openPublicLink(
      async () => {
        throw new Error("offline");
      },
      () => ({
        navigate: () => events.push("navigate"),
        close: () => events.push("close"),
      }),
    ),
    /offline/,
  );
  assert.deepEqual(events, ["close"]);
});

test("a blocked popup does not start discovery", async () => {
  let loaded = false;
  await assert.rejects(
    openPublicLink(
      async () => {
        loaded = true;
        return "unused";
      },
      () => null,
    ),
    /blocked/,
  );
  assert.equal(loaded, false);
});
