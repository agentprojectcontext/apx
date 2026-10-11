import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findV1 } from "../rpc/setup.ts";
import { jsonFile } from "./v1-data.ts";

test("v1's files are read even when a Windows editor saved them with a BOM", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-v1-bom-"));
  try {
    const project = path.join(home, "demo");
    fs.mkdirSync(path.join(project, ".apc"), { recursive: true });
    fs.writeFileSync(path.join(project, ".apc", "project.json"), `﻿${JSON.stringify({ name: "Northwind" })}`);
    fs.writeFileSync(path.join(home, "config.json"), `﻿${JSON.stringify({ projects: [{ path: project }] })}`);
    assert.deepEqual(jsonFile(path.join(home, "config.json")), { projects: [{ path: project }] });
    assert.equal(findV1(home)?.projects, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
