import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createLog } from "../log.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createGreetings, type GreetingVoice, greetingLine, pcmWav, wavPcm } from "./greetings.ts";

function setup() {
  const dir = tempDir("apx-greetings-");
  let voice: GreetingVoice = { locale: "es-AR", gender: "female", owner: "Ana Pérez", engine: "native" };
  const said: string[] = [];
  let hold: Promise<void> = Promise.resolve();
  const greetings = createGreetings({
    dir: path.join(dir.path, "greetings"),
    voice: () => voice,
    record: async (text, v) => {
      said.push(`${text}|${v.gender}`);
      await hold;
      return Buffer.from(`pcm:${text}`);
    },
    log: createLog("test", true),
  });
  return {
    dir,
    greetings,
    said,
    setVoice: (v: Partial<GreetingVoice>) => {
      voice = { ...voice, ...v };
    },
    holdRecording: () => {
      let release = () => {};
      hold = new Promise((r) => {
        release = r;
      });
      return release;
    },
  };
}

test("the greeting says the owner's first name in the voice's language", () => {
  assert.equal(greetingLine("quick", "es-AR", "Ana Pérez"), "¿Sí, Ana?");
  assert.equal(greetingLine("quick", "en-US", ""), "Yes?");
  assert.equal(greetingLine("call", "es", "Ana"), "Hola Ana, ¿en qué te puedo ayudar?");
});

test("a WAV round trip keeps the samples", () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  assert.deepEqual(wavPcm(pcmWav(pcm)), pcm);
  assert.equal(pcmWav(pcm).readUInt32LE(24), 24_000);
});

test("a greeting is recorded once, when a device first asks for it", async () => {
  const t = setup();
  await using _ = t.dir;
  assert.equal(t.greetings.status(), undefined);
  const first = t.greetings.get("quick");
  assert.equal(first.pcm, undefined);
  assert.equal(first.text, "¿Sí, Ana?");
  const ready = await waitFor(() => t.greetings.get("quick").pcm, "the greeting to be recorded");
  assert.equal(ready.toString(), "pcm:¿Sí, Ana?");
  t.greetings.get("quick");
  assert.deepEqual(t.said, ["¿Sí, Ana?|female"]);
  assert.equal(t.greetings.status(), "ready");
});

test("a new voice records the greetings in use again, and says it is preparing meanwhile", async () => {
  const t = setup();
  await using _ = t.dir;
  t.greetings.get("quick");
  const old = await waitFor(
    () => t.greetings.get("quick").key && t.greetings.get("quick").pcm && t.greetings.get("quick"),
  );
  const release = t.holdRecording();
  t.setVoice({ gender: "male" });
  assert.equal(t.greetings.status(), "preparing");
  assert.deepEqual(t.said, ["¿Sí, Ana?|female"]);
  t.greetings.refresh();
  release();
  await waitFor(() => t.greetings.status() === "ready", "the new greeting");
  const now = t.greetings.get("quick");
  assert.notEqual(now.key, old.key);
  assert.deepEqual(t.said, ["¿Sí, Ana?|female", "¿Sí, Ana?|male"]);
  // Only the current recording is kept, and the full call's greeting nobody asked for is never recorded.
  assert.deepEqual(fs.readdirSync(path.join(t.dir.path, "greetings")), [`quick-${now.key}.pcm`]);
});
