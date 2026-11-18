import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { filesOf, fingerprint, legacyFingerprint } from "./package.ts";

const llm = scriptedLlm(() => say("ok"));

/** An extension folder with nested files, so "/" and "\" give different fingerprints. */
function source(root: string, id: string): string {
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, "skills", "notes"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "apx-extension.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", skills: "skills" }),
  );
  fs.writeFileSync(
    path.join(dir, "skills", "notes", "SKILL.md"),
    "---\nname: notes\ndescription: Notes.\n---\nRead.\n",
  );
  fs.writeFileSync(path.join(dir, "skills[old].md"), "sorts apart under the two separators");
  return dir;
}

test("an extension approved with the old Windows fingerprint stays on; one whose files changed turns off", async () => {
  await using home = tempDir("apx-ext-legacy-");
  await using work = tempDir("apx-ext-legacy-src-");
  const first = await startCore({ llm, home: home.path });
  for (const id of ["kept", "edited"]) {
    await first.client.call("extensions.install", { path: source(work.path, id) });
    await first.client.call("extensions.enable", { id, enabled: true });
  }
  // As a Windows install recorded them before fingerprints used "/" everywhere.
  const legacy = (id: string) => {
    const dir = path.join(home.path, "extensions", id);
    const files = filesOf(dir);
    assert.notEqual(legacyFingerprint(dir, files), fingerprint(dir, files));
    first.core.store.extensions.setHash(id, legacyFingerprint(dir, files));
    return { dir, files };
  };
  const kept = legacy("kept");
  const edited = legacy("edited");
  await first.core.close();
  fs.writeFileSync(path.join(edited.dir, "skills", "notes", "SKILL.md"), "changed after it was approved");

  const again = await startCore({ llm, home: home.path });
  try {
    const { extensions } = await again.client.call("extensions.list", {});
    const byId = Object.fromEntries(extensions.map((e) => [e.id, e]));
    assert.equal(byId.kept?.enabled, true);
    assert.equal(byId.kept?.hash, fingerprint(kept.dir, kept.files));
    assert.equal(byId.edited?.enabled, false);
    // Rewritten once: turning it off and on again needs nothing more.
    await again.client.call("extensions.enable", { id: "kept", enabled: false });
    assert.equal((await again.client.call("extensions.enable", { id: "kept", enabled: true })).enabled, true);
  } finally {
    await again.core.close();
  }
});
