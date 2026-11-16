import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoiceStatus } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import { createStore } from "../domain/store.ts";
import type { LocalEmbeddings, OllamaState, Pull } from "../services/local-embed.ts";
import { tempDir } from "../testkit/platform.ts";
import type { VoiceDeps } from "./calls.ts";
import { prepareHandlers } from "./setup-prepare.ts";

/** Ollama as a fake: here or not, a pull that runs until the test says it ended. */
function fakeOllama(running: boolean) {
  let pull: Pull | undefined;
  const installs: string[] = [];
  const local = {
    state: async (): Promise<OllamaState> => ({ url: "http://127.0.0.1:11434", running, models: [] }),
    progress: () => pull,
    install: async (model: string) => {
      installs.push(model);
      pull = { model, completed: 0, total: 100 };
    },
  } as unknown as LocalEmbeddings;
  return { local, installs, half: () => (pull = pull && { ...pull, completed: 50 }), end: () => (pull = undefined) };
}

function fakeVoice(v: Partial<VoiceStatus>) {
  let installs = 0;
  const status = { tier: "light", installed: false, ...v } as VoiceStatus;
  const voice = { native: { status: () => status, install: () => void installs++ } } as unknown as VoiceDeps;
  return { voice, installs: () => installs };
}

/** Timers the test runs by hand. */
function handTimers() {
  const fns = new Set<() => void>();
  return {
    every: (fn: () => void) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    tick: () => {
      for (const fn of [...fns]) fn();
    },
  };
}

async function withStore(run: (store: ReturnType<typeof createStore>) => Promise<void>) {
  const home = tempDir("apx-prepare-");
  const db = openDb(home.path);
  try {
    await run(createStore(db, createBus()));
  } finally {
    db.close();
    await home.remove();
  }
}

test("with Ollama here, memory pulls the model that fits and then searches by meaning", () =>
  withStore(async (store) => {
    const ollama = fakeOllama(true);
    let engine: string | undefined;
    const timers = handTimers();
    const h = prepareHandlers({
      store,
      local: ollama.local,
      engine: () => engine,
      voice: undefined,
      chatgpt: () => false,
      every: timers.every,
    });
    assert.equal((await h["setup.prepare_status"]()).items[0]?.state, "waiting");
    const first = await h["setup.prepare"]();
    assert.equal(ollama.installs.length, 1);
    assert.deepEqual(first.items[0], { id: "memory", state: "working", progress: 0 });
    ollama.half();
    assert.equal((await h["setup.prepare_status"]()).items[0]?.progress, 0.5);
    await h["setup.prepare"]();
    assert.equal(ollama.installs.length, 1, "it starts once");
    ollama.end();
    engine = "Ollama · bge-m3";
    timers.tick();
    assert.equal(memorySettings(store).mode, "semantic");
    assert.deepEqual((await h["setup.prepare_status"]()).items[0], {
      id: "memory",
      state: "done",
      detail: "Ollama · bge-m3",
    });
  }));

test("without Ollama, memory stays notes and says why; images need the ChatGPT plan", () =>
  withStore(async (store) => {
    const h = prepareHandlers({
      store,
      local: fakeOllama(false).local,
      engine: () => undefined,
      voice: undefined,
      chatgpt: () => false,
      every: handTimers().every,
    });
    const r = await h["setup.prepare"]();
    assert.deepEqual(r.items, [
      { id: "memory", state: "skipped", reason: "no-ollama" },
      { id: "voice", state: "skipped", reason: "machine" },
      { id: "images", state: "skipped", reason: "no-chatgpt" },
    ]);
    assert.equal(memorySettings(store).mode, "notes");
  }));

test("the voice downloads where the machine runs it, and never where it cannot", () =>
  withStore(async (store) => {
    const base = { store, local: fakeOllama(false).local, engine: () => undefined, every: handTimers().every };
    const can = fakeVoice({});
    const h = prepareHandlers({ ...base, voice: can.voice, chatgpt: () => true });
    const r = await h["setup.prepare"]();
    assert.equal(can.installs(), 1);
    assert.equal(r.items[1]?.state, "working");
    assert.deepEqual(r.items[2], { id: "images", state: "done" });

    const cannot = fakeVoice({ tier: "none", missing: "memory" });
    await prepareHandlers({ ...base, voice: cannot.voice, chatgpt: () => false })["setup.prepare"]();
    assert.equal(cannot.installs(), 0);
  }));
