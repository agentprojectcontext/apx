// An idle core gives back the young generation V8 grew for startup or a busy stretch: V8 alone never does, since
// it only shrinks it in a GC and an idle core makes none. See HISTORY.md#idle-memory.
import v8 from "node:v8";
import vm from "node:vm";

/** The young generation: what V8 has committed for it and how much of it holds objects. */
export type YoungGen = { size: number; used: number };

export type IdleTrimOptions = {
  /** How often the heap is looked at. */
  everyMs?: number;
  /** After start, when what loading grew is given back without waiting for a quiet look. */
  settleMs?: number;
  /** Below this much new allocation between two looks the core counts as idle. */
  quietBytes?: number;
  /** A young generation this small is left alone (V8 starts at about 1 MB). */
  minSize?: number;
  /** Tests pass a fake heap and collector. */
  youngGen?: () => YoungGen;
  collect?: () => void;
};

const MB = 1024 * 1024;

export function createIdleTrim(opts: IdleTrimOptions = {}) {
  const everyMs = opts.everyMs ?? 5000;
  const settleMs = opts.settleMs ?? 1000;
  const quiet = opts.quietBytes ?? MB;
  const minSize = opts.minSize ?? 8 * MB;
  const youngGen = opts.youngGen ?? v8YoungGen;
  const collect = opts.collect ?? reducingGc;
  let last: YoungGen | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let trims = 0;

  function trim(): boolean {
    collect();
    trims++;
    last = youngGen();
    return true;
  }

  /** One look: true when it gave memory back. */
  function check(): boolean {
    const now = youngGen();
    const prev = last;
    last = now;
    // A drop in use means a collection ran since the last look: the core was allocating, so not idle.
    if (!prev || now.size < minSize || now.used < prev.used || now.used - prev.used >= quiet) return false;
    return trim();
  }

  return {
    check,
    start() {
      if (timer) return;
      last = youngGen();
      // Loading is over once the core is up: give back what it grew now, so V8's own cleanup GCs (about 8 s
      // after any full GC) end while the core is still starting rather than when it is idle.
      settle = setTimeout(() => youngGen().size >= minSize && trim(), settleMs);
      settle.unref();
      timer = setInterval(check, everyMs);
      timer.unref();
    },
    stop() {
      if (settle) clearTimeout(settle);
      if (timer) clearInterval(timer);
      timer = settle = undefined;
    },
    trims: () => trims,
  };
}

function v8YoungGen(): YoungGen {
  const s = v8.getHeapSpaceStatistics().find((x) => x.space_name === "new_space");
  return { size: s?.space_size ?? 0, used: s?.space_used_size ?? 0 };
}

type GcFn = (opts: { type: "major"; execution: "sync"; flavor: "last-resort" }) => void;

/** A full GC that also shrinks what V8 keeps committed, as on low memory. Node reaches it only through `gc`. */
function reducingGc(): void {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as GcFn;
  v8.setFlagsFromString("--no-expose-gc");
  gc({ type: "major", execution: "sync", flavor: "last-resort" });
}
