import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { artifactSourceDir, artifacts } from "./artifacts.ts";
import { printed, recordingClient } from "./testing.ts";

const shown = { id: "srf_1", name: "expenses", title: "Expenses", version: 3, app: true, project_id: "p_acme" };

test("artifacts push shows a built page by name, in the project asked for, titled from the page", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-artifacts-"));
  try {
    const file = path.join(dir, "index.html");
    fs.writeFileSync(file, "<title>Expenses</title><p>built</p>");
    const { client, calls } = recordingClient({ "surfaces.show": shown });
    const out = await printed(() =>
      artifacts(client, ["push", "expenses", file], {
        app: true,
        project: "p_acme",
        connect: "https://api.example.com, https://rates.example.com",
      }),
    );
    assert.match(out, /expenses {2}v3 {2}app {2}p_acme/);
    assert.deepEqual(calls, [
      [
        "surfaces.show",
        {
          name: "expenses",
          title: "Expenses",
          html: "<title>Expenses</title><p>built</p>",
          app: true,
          connect: ["https://api.example.com", "https://rates.example.com"],
          project: "p_acme",
        },
      ],
    ]);
    await assert.rejects(artifacts(client, ["push", "Bad Name", file], {}), /kebab-case/);
    await assert.rejects(artifacts(client, ["push", "expenses"], {}), /usage:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("artifacts list shows each one's kind and project", async () => {
  const { client, calls } = recordingClient({
    "surfaces.list": { surfaces: [shown, { ...shown, name: "rates", app: false, project_id: undefined }] },
  });
  const out = await printed(() => artifacts(client, [], {}));
  assert.match(out, /expenses +app +v3 +p_acme {2}Expenses/);
  assert.match(out, /rates +widget +v3 +global/);
  assert.deepEqual(calls, [["surfaces.list", {}]]);
});

test("a built artifact's source lives in APX's home apart from its memory, per project", () => {
  assert.equal(artifactSourceDir("/h", "expenses"), path.join("/h", "artifact-sources", "global", "expenses"));
  assert.equal(
    artifactSourceDir("/h", "expenses", "p_acme"),
    path.join("/h", "artifact-sources", "p_acme", "expenses"),
  );
  assert.throws(() => artifactSourceDir("/h", "../up"), /kebab-case/);
  assert.throws(() => artifactSourceDir("/h", "expenses", "../x"), /not a project id/);
});
