import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../../core/src/testkit/platform.ts";
import { assembleSite } from "./assemble-site.mjs";

test("assembly copies both builds and installers without modifying either input", async () => {
  await using dir = tempDir("apx-site-assembly-");
  const v1 = join(dir.path, "historical");
  const v2 = join(dir.path, "current");
  const out = join(dir.path, "site");
  await mkdir(v1);
  await mkdir(v2);
  await writeFile(join(v1, "index.html"), "Historical documentation");
  await writeFile(join(v2, "index.html"), "Current web home");
  await writeFile(join(v2, "404.html"), "<html><head></head><body>404</body></html>");
  for (const name of ["install.sh", "install.ps1"]) await writeFile(join(v2, name), `Installer: ${name}`);
  await assembleSite({ v1, v2, out });
  assert.equal(await readFile(join(out, "v1", "index.html"), "utf8"), "Historical documentation");
  assert.equal(await readFile(join(out, "index.html"), "utf8"), "Current web home");
  for (const name of ["install.sh", "install.ps1"]) {
    assert.deepEqual(await readFile(join(out, "v2", name)), await readFile(join(v2, name)));
  }
  assert.equal(await readFile(join(v2, "404.html"), "utf8"), "<html><head></head><body>404</body></html>");
  assert.equal(await readFile(join(v1, "index.html"), "utf8"), "Historical documentation");
  await access(join(out, ".nojekyll"));
  await assert.rejects(assembleSite({ v1, v2, out }), { code: "EEXIST" });
});

test("assembly refuses reserved version directories before creating output", async () => {
  await using dir = tempDir("apx-site-assembly-");
  const v2 = join(dir.path, "current");
  const out = join(dir.path, "site");
  await mkdir(join(v2, "v1"), { recursive: true });
  await assert.rejects(assembleSite({ v1: join(dir.path, "historical"), v2, out }), /already contains v1/);
  await assert.rejects(access(out), { code: "ENOENT" });
});
