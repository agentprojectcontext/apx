import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { hermesImport } from "./hermes-import.ts";
import { printed, recordingClient } from "./testing.ts";

test("import hermes previews first; --yes imports and prints what was done", async () => {
  const items = [
    { kind: "agent", profile: "default", name: "hermes", action: "add" },
    { kind: "server", profile: "default", name: "tracker", action: "add", why: "secret", detail: "TRACKER_API_TOKEN" },
    { kind: "setting", profile: "default", name: "TELEGRAM_BOT_TOKEN", action: "skip", why: "secret" },
  ];
  const { client, calls } = recordingClient({ "hermes.preview": { items }, "hermes.import": { items } });
  const look = await printed(() => hermesImport(client, "~/work/.hermes", {}));
  assert.match(look, /add +server +default +tracker +a secret: give it in APX: TRACKER_API_TOKEN/);
  assert.match(look, /Add --yes to import these 2\./);
  assert.deepEqual(calls, [["hermes.preview", { path: path.resolve("~/work/.hermes") }]]);
  await printed(() => hermesImport(client, "~/work/.hermes", { yes: true }));
  assert.deepEqual(calls.at(-1), ["hermes.import", { path: path.resolve("~/work/.hermes") }]);
  await assert.rejects(hermesImport(client, undefined, {}), /usage: apx import hermes/);
});
