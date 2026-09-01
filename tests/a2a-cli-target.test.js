import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-cli-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { http } = await import("#interfaces/cli/http.js");
const { writeIdentity } = await import("#core/identity/self.js");
const { resolveSendTarget } = await import("#interfaces/cli/commands/a2a.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

test("sending to Roby follows the sender's project without --project", async () => {
  writeIdentity({ agent_name: "Roby" });
  const defaultRoot = makeTempProject({
    name: "default",
    agents: [{ slug: "crypto-analyst", role: "Analyst" }],
  });
  const otherRoot = makeTempProject({
    name: "other",
    agents: [{ slug: "editor", role: "Editor" }],
  });
  const rows = [
    { id: 0, name: "default", path: defaultRoot },
    { id: 8, name: "other", path: otherRoot },
  ];
  const originalGet = http.get;
  http.get = async (url) => {
    assert.equal(url, "/api/projects");
    return rows;
  };

  try {
    assert.equal(await resolveSendTarget("roby", undefined, "crypto-analyst"), 0);
    assert.equal(await resolveSendTarget("Roby:alerts", undefined, "crypto-analyst"), 0);
  } finally {
    http.get = originalGet;
    cleanupTempProject(defaultRoot);
    cleanupTempProject(otherRoot);
  }
});
