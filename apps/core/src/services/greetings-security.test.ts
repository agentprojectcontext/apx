import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { tempDir } from "../testkit/platform.ts";
import { createGreetings, type GreetingVoice } from "./greetings.ts";

function setup() {
  const dir = tempDir("apx-greeting-security-");
  let enabled = true;
  let voice: GreetingVoice = { locale: "en-US", gender: "female", owner: "", engine: "services" };
  const pending: { signal: AbortSignal; resolve: (pcm: Buffer) => void; done: Promise<Buffer> }[] = [];
  const greetings = createGreetings({
    dir: path.join(dir.path, "greetings"),
    voice: () => voice,
    enabled: () => enabled,
    record: (_text, _voice, signal) => {
      let resolve = (_pcm: Buffer) => {};
      const done = new Promise<Buffer>((r) => {
        resolve = r;
      });
      pending.push({ signal, resolve, done });
      return done;
    },
    log: createLog("test", true),
  });
  const finish = async (index: number, text: string) => {
    const item = pending[index];
    assert.ok(item);
    item.resolve(Buffer.from(text));
    await item.done;
  };
  return {
    dir,
    greetings,
    pending,
    finish,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setVoice: (gender: "female" | "male") => {
      voice = { ...voice, gender };
    },
  };
}

test("reading greeting status never synthesizes a changed voice", async () => {
  const t = setup();
  await using _ = t.dir;
  t.greetings.get("quick");
  await t.finish(0, "original");
  t.setVoice("male");
  assert.equal(t.greetings.status(), "preparing");
  assert.equal(t.greetings.status(), "preparing");
  assert.equal(t.pending.length, 1);
});

test("turning calls off aborts pending synthesis and ignores a provider's late result", async () => {
  const t = setup();
  await using _ = t.dir;
  t.greetings.get("quick");
  t.setEnabled(false);
  t.greetings.refresh();
  assert.equal(t.pending[0]?.signal.aborted, true);
  await t.finish(0, "late");
  assert.equal(t.greetings.status(), undefined);
  assert.equal(t.greetings.get("call").pcm, undefined);
  assert.equal(t.pending.length, 1);
  assert.equal(fs.existsSync(path.join(t.dir.path, "greetings")), false);
});

test("an older synthesis cannot overwrite or delete the newer greeting", async () => {
  const t = setup();
  await using _ = t.dir;
  const old = t.greetings.get("quick");
  t.setVoice("male");
  const latest = t.greetings.get("quick");
  assert.notEqual(old.key, latest.key);
  assert.equal(t.pending[0]?.signal.aborted, true);
  await t.finish(1, "current");
  await t.finish(0, "obsolete");
  assert.equal(t.greetings.get("quick").pcm?.toString(), "current");
  assert.deepEqual(fs.readdirSync(path.join(t.dir.path, "greetings")), [`quick-${latest.key}.pcm`]);
});
