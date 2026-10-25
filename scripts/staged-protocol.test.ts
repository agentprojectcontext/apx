import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../apps/core/src/testkit/platform.ts";
import { stageProtocol } from "../apps/desktop/scripts/stage-protocol.ts";

test("the staged protocol exports execute outside the workspace", async () => {
  const dir = tempDir("apx-staged-protocol-");
  try {
    const repo = path.resolve(import.meta.dirname, "..");
    const out = path.join(dir.path, "node_modules/@apx/protocol");
    await stageProtocol(path.join(repo, "packages/protocol"), out, "1.2.3");
    fs.symlinkSync(path.join(repo, "apps/core/node_modules/zod"), path.join(dir.path, "node_modules/zod"), "junction");
    const result = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import { exitWhenClosed } from '@apx/protocol/exit';
      import { noticeEn } from '@apx/protocol/notices';
      exitWhenClosed(0);
      assert.equal(process.exitCode, 0);
      assert.equal(noticeEn['notice.routine.shell'], 'Ran the command.');
      for (const name of ['@apx/protocol', '@apx/protocol/client', '@apx/protocol/cdp']) {
        assert.ok(Object.keys(await import(name)).length > 0);
      }
      console.log('staged exports ready');
    `,
      ],
      { cwd: dir.path, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.trim(), "staged exports ready");
  } finally {
    await dir.remove();
  }
});
