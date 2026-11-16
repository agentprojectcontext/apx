// What a simple setup leaves ready on its own once a brain is connected: memory that searches by meaning (an
// embedding model through Ollama, when it is here), APX's own voice for voice notes and calls (where the machine can
// run it), and images (with the ChatGPT plan). Each part says where it stands; nothing here asks the owner anything.
import os from "node:os";
import type { SetupPrepare } from "@apx/protocol";
import { memorySettings, saveMemorySettings } from "../domain/memory-settings.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { LocalEmbeddings } from "../services/local-embed.ts";
import { recommendEmbedder } from "../services/local-embed.ts";
import type { VoiceDeps } from "./calls.ts";
import type { Handlers } from "./router.ts";

type Item = SetupPrepare["items"][number];
/** How often a started preparation checks whether memory's engine is ready, to switch memory to meaning. */
const WATCH_MS = 3000;
/** A pull longer than this is left to run; memory switches the next time the setup asks. */
const WATCH_LIMIT_MS = 60 * 60_000;

export type PrepareDeps = {
  store: Store;
  local: LocalEmbeddings;
  /** Memory's embedding engine in use now, when there is one. */
  engine: () => string | undefined;
  voice: VoiceDeps | undefined;
  /** The ChatGPT plan is signed in: images come with it. */
  chatgpt: () => boolean;
  /** Timers, injected so tests decide time. */
  every?: (fn: () => void, ms: number) => () => void;
};

const realEvery = (fn: () => void, ms: number) => {
  const id = setInterval(fn, ms);
  id.unref?.();
  return () => clearInterval(id);
};

export function prepareHandlers(d: PrepareDeps) {
  const every = d.every ?? realEvery;
  let started = false;
  let ollama: boolean | undefined;
  let memoryError: string | undefined;

  /** Memory searches by meaning once an engine answers; a setup that started the pull switches it then. */
  const toMeaning = () => {
    if (!d.engine()) return false;
    const now = memorySettings(d.store);
    if (now.mode !== "semantic") saveMemorySettings(d.store, { ...now, mode: "semantic" });
    return true;
  };

  async function startMemory(): Promise<void> {
    if (toMeaning()) return;
    const state = await d.local.state();
    ollama = state.running;
    if (!state.running) return;
    try {
      await d.local.install(recommendEmbedder(os.totalmem() / 2 ** 30));
    } catch (err) {
      memoryError = errorMessage(err, 200);
      return;
    }
    let waited = 0;
    const stop = every(() => {
      waited += WATCH_MS;
      if (toMeaning() || d.local.progress()?.error || waited >= WATCH_LIMIT_MS) stop();
    }, WATCH_MS);
  }

  function memory(): Item {
    const engine = d.engine();
    if (engine) {
      if (started) toMeaning();
      return { id: "memory", state: "done", detail: engine };
    }
    const pull = d.local.progress();
    if (pull?.error || memoryError) return { id: "memory", state: "failed", error: pull?.error ?? memoryError };
    if (pull)
      return { id: "memory", state: "working", ...(pull.total ? { progress: pull.completed / pull.total } : {}) };
    if (ollama === false) return { id: "memory", state: "skipped", reason: "no-ollama" };
    return { id: "memory", state: started ? "working" : "waiting" };
  }

  function voice(): Item {
    const v = d.voice?.native.status();
    if (!v || v.tier === "none" || v.missing) return { id: "voice", state: "skipped", reason: "machine" };
    if (v.installed) return { id: "voice", state: "done" };
    if (v.install?.state === "failed") return { id: "voice", state: "failed", error: v.install.error };
    if (v.install)
      return {
        id: "voice",
        state: "working",
        ...(v.install.total ? { progress: v.install.received / v.install.total } : {}),
      };
    return { id: "voice", state: started ? "working" : "waiting" };
  }

  const images = (): Item =>
    d.chatgpt() ? { id: "images", state: "done" } : { id: "images", state: "skipped", reason: "no-chatgpt" };

  const status = (): SetupPrepare => ({ started, items: [memory(), voice(), images()] });

  return {
    "setup.prepare": async () => {
      if (!started) {
        started = true;
        const v = d.voice?.native.status();
        if (v && v.tier !== "none" && !v.missing && !v.installed && !v.install) d.voice?.native.install();
        await startMemory();
      }
      return status();
    },
    "setup.prepare_status": () => status(),
  } satisfies Partial<Handlers>;
}
