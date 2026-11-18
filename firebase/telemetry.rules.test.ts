import assert from "node:assert/strict";
import { test } from "node:test";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error("Run with firebase emulators:exec --only firestore --project demo-apx-account");
const project = "demo-apx-account";
const database = `projects/${project}/databases/(default)`;
const root = `http://${host}/v1/${database}/documents`;
const install = "00000000-0000-4000-8000-000000000001";
const field = (value: string) => ({ stringValue: value });
function token(reader = false) {
  const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${json({ alg: "none", typ: "JWT" })}.${json({
    sub: "account-owner",
    user_id: "account-owner",
    aud: project,
    iss: `https://securetoken.google.com/${project}`,
    iat: 1,
    exp: 4102444800,
    ...(reader ? { telemetry_reader: true } : {}),
    firebase: { sign_in_provider: "google.com", identities: {} },
  })}.`;
}
async function call(path: string, body?: unknown, auth?: string) {
  return fetch(`${root}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const stamps = (...paths: string[]) => paths.map((fieldPath) => ({ fieldPath, setToServerValue: "REQUEST_TIME" }));
const installWrite = {
  update: {
    name: `${database}/documents/installs/${install}`,
    fields: {
      first_version: field("2.16.0"),
      version: field("2.16.0"),
      os: field("test"),
      arch: field("test"),
      channel: field("test"),
      usage: { booleanValue: true },
      stages: { mapValue: { fields: {} } },
    },
  },
  currentDocument: { exists: false },
  updateTransforms: stamps("created", "updated_at", "stages.installed"),
};

test("Google accounts do not change anonymous telemetry writes or grant private telemetry access", async () => {
  for (const auth of [token(), token(true)]) {
    assert.equal((await call(":commit", { writes: [installWrite] }, auth)).status, 403);
  }
  assert.equal((await call(":commit", { writes: [installWrite] })).status, 200);
  const update = {
    update: { name: installWrite.update.name, fields: { version: field("2.16.1") } },
    updateMask: { fieldPaths: ["version"] },
    updateTransforms: stamps("updated_at", "stages.opened"),
  };
  assert.equal((await call(":commit", { writes: [update] })).status, 200);
  assert.equal((await call(":commit", { writes: [update] }, token())).status, 403);
  const fields = Object.fromEntries(
    ["tokens_in", "tokens_out", "runs", "projects", "agents", "channels", "routines"].map((key) => [
      key,
      { integerValue: "1" },
    ]),
  );
  const report = {
    update: {
      name: `${installWrite.update.name}/days/2026-01-01`,
      fields: { ...fields, version: field("2.16.1") },
    },
    currentDocument: { exists: false },
    updateTransforms: stamps("at"),
  };
  assert.equal((await call(":commit", { writes: [report] }, token())).status, 403);
  assert.equal((await call(":commit", { writes: [report] })).status, 200);
  for (const path of [`/installs/${install}`, `/installs/${install}/days/2026-01-01`, "/installs"]) {
    assert.equal((await call(path)).status, 403);
    assert.equal((await call(path, undefined, token())).status, 403);
    assert.equal((await call(path, undefined, token(true))).status, 200);
  }
  const invalid = {
    ...report,
    update: {
      ...report.update,
      name: `${installWrite.update.name}/days/2026-01-02`,
      fields: { ...report.update.fields, runs: { integerValue: "-1" } },
    },
  };
  assert.equal((await call(":commit", { writes: [invalid] })).status, 403);
  const alter = { ...report, currentDocument: { exists: true } };
  assert.equal((await call(":commit", { writes: [alter] })).status, 403);
});
