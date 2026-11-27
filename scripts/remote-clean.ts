// What `pnpm remote` removes on the machine before a run, so its disk never fills (rules/TESTING.md#remote-runner).
// The machine reports facts (one line each), this file decides, and the shell it sends back re-checks every slot under
// that slot's lock: a slot a run is starting in, or whose box is running, is never touched.

/** A slot folder: its name, when a run last fetched into it (epoch s), and whether its run is in a merged branch. */
export type Slot = { name: string; usedAt: number; merged: boolean };
/** A box (container): the slot it ran for, whether it still runs, when it ended (epoch s, 0 while running). */
export type Box = { slot: string; running: boolean; endedAt: number };
export type Facts = { now: number; freeKb: number; slots: Slot[]; boxes: Box[] };

export type Reason = "merged" | "unused";
export type CleanPlan = {
  slots: { name: string; usedAt: number; reason: Reason }[];
  /** Slots whose finished box goes. */
  boxes: string[];
};

export type CleanOptions = {
  /** The slot this run is about to use: it stays, whatever its age. */
  keep?: string;
  /** A slot not run for this many days goes. */
  days: number;
  /** Slots whose run is always in the target branch (the target itself): only age removes them. */
  longLived?: string[];
};

const DAY = 86_400;
/** A finished box stays this long so `pnpm remote status` still shows how it ended. */
const BOX_KEEP_S = DAY;
const SAFE = /^[a-z0-9_.-]+$/;

/** The facts the machine prints (`factsScript`): `now`, `free`, `slot name usedAt merged`, `box slot running endedAt`. */
export function parseFacts(text: string): Facts {
  const facts: Facts = { now: 0, freeKb: 0, slots: [], boxes: [] };
  for (const line of text.split("\n")) {
    const [kind, ...f] = line.trim().split("\t");
    if (kind === "now") facts.now = Number(f[0]) || 0;
    else if (kind === "free") facts.freeKb = Number(f[0]) || 0;
    else if (kind === "slot" && f[0] && SAFE.test(f[0]))
      facts.slots.push({ name: f[0], usedAt: Number(f[1]) || 0, merged: f[2] === "1" });
    else if (kind === "box" && f[0] && SAFE.test(f[0])) {
      const ended = Date.parse(f[2] ?? "");
      facts.boxes.push({
        slot: f[0],
        running: f[1] === "true",
        endedAt: Number.isFinite(ended) && ended > 0 ? Math.floor(ended / 1000) : 0,
      });
    }
  }
  return facts;
}

/** Which slots and finished boxes go. A slot with a running box, or the one this run uses, always stays. */
export function planClean(facts: Facts, opts: CleanOptions): CleanPlan {
  const running = new Set(facts.boxes.filter((b) => b.running).map((b) => b.slot));
  const longLived = new Set(opts.longLived ?? []);
  const slots: CleanPlan["slots"] = [];
  for (const s of facts.slots) {
    if (s.name === opts.keep || running.has(s.name)) continue;
    if (s.merged && !longLived.has(s.name)) slots.push({ name: s.name, usedAt: s.usedAt, reason: "merged" });
    else if (facts.now - s.usedAt > opts.days * DAY) slots.push({ name: s.name, usedAt: s.usedAt, reason: "unused" });
  }
  const gone = new Set(slots.map((s) => s.name));
  const present = new Set(facts.slots.map((s) => s.name));
  const boxes = facts.boxes
    .filter((b) => !b.running && b.slot !== opts.keep)
    .filter((b) => gone.has(b.slot) || !present.has(b.slot) || facts.now - b.endedAt > BOX_KEEP_S)
    .map((b) => b.slot);
  return { slots, boxes };
}

// Deletes what was moved to trash/, under one lock so two cleanups never race on it.
const EMPTY_TRASH = `flock locks/trash.lock sh -c 'for t in trash/*; do [ -e "$t" ] || continue; rm -rf "$t" 2>/dev/null || { chmod -R u+w "$t"; rm -rf "$t"; }; done'`;
const FREE = `printf 'free\\t%s\\n' "$(df -Pk . | awk 'NR==2{print $4}')"`;

// When a slot was last used: a run's fetch touches FETCH_HEAD; a slot without one goes by its folder.
const USED = `used() { stat -c %Y "$1/.git/FETCH_HEAD" 2>/dev/null || stat -c %Y "$1"; }`;

/** Prints the facts, run in the remote folder. A slot is merged when its run's commit is in any `refs/merged/*`. */
export function factsScript(): string {
  return [
    USED,
    `printf 'now\\t%s\\n' "$(date +%s)"`,
    FREE,
    `for d in slots/*/; do [ -d "$d" ] || continue; s=$(basename "$d"); m=0`,
    `  run=$(git -C apx.git rev-parse -q --verify "refs/runs/$s^{commit}" 2>/dev/null) &&`,
    `    for t in $(git -C apx.git for-each-ref --format='%(refname)' refs/merged); do git -C apx.git merge-base --is-ancestor "$run" "$t" 2>/dev/null && m=1 && break; done`,
    `  printf 'slot\\t%s\\t%s\\t%s\\n' "$s" "$(used "$d")" "$m"`,
    "done",
    `ids=$(docker ps -aq --filter label=apx-remote)`,
    `[ -z "$ids" ] || docker inspect -f '{{index .Config.Labels "apx-remote"}}\t{{.State.Running}}\t{{.State.FinishedAt}}' $ids | sed 's/^/box\t/'`,
  ].join("\n");
}

/**
 * Removes what the plan says, run in the remote folder. Each slot is moved out under its lock (the one a starting run
 * holds), only if no box runs for it and nobody fetched into it since the facts; then it is deleted. A box goes with
 * `docker rm` without force, which refuses one that started again. The moved slots are deleted in the background (a
 * slot is millions of files: the run does not wait), the build cache is capped and the free space printed:
 * `removed <slot>`, `free <kb>`.
 */
export function cleanScript(plan: CleanPlan, facts: Facts, buildCache: string): string {
  const usedAt = new Map(facts.slots.map((s) => [s.name, s.usedAt]));
  const lines = [
    USED,
    "mkdir -p locks trash",
    `gone() { ( flock -n 9 || exit 1`,
    `  [ "$(docker inspect -f '{{.State.Running}}' "apx-$1" 2>/dev/null)" = true ] && exit 1`,
    `  [ -d "slots/$1" ] && [ "$(used "slots/$1")" = "$2" ] || exit 1`,
    `  docker rm -f "apx-$1" >/dev/null 2>&1; mv "slots/$1" "trash/$1.$$" || exit 1`,
    `  git -C apx.git update-ref -d "refs/runs/$1" 2>/dev/null; exit 0`,
    `) 9>"locks/$1.lock" && printf 'removed\\t%s\\n' "$1"; }`,
  ];
  for (const s of plan.slots) if (SAFE.test(s.name)) lines.push(`gone ${s.name} ${usedAt.get(s.name) ?? 0}`);
  for (const b of plan.boxes) if (SAFE.test(b)) lines.push(`docker rm apx-${b} >/dev/null 2>&1 || true`);
  lines.push(
    `nohup setsid ${EMPTY_TRASH.replace("flock ", "flock -n ")} </dev/null >/dev/null 2>&1 &`,
    `docker builder prune -f --max-used-space ${buildCache} >/dev/null 2>&1 || true`,
    FREE,
  );
  return lines.join("\n");
}

/** Waits (up to 30 min) for the trash to be deleted, deleting what is left itself, then prints `free <kb>`. */
export function emptyTrashScript(): string {
  return [`mkdir -p locks trash`, `timeout 1800 ${EMPTY_TRASH} || true`, FREE].join("\n");
}

/** `removed` and `free` lines of `cleanScript`. */
export function parseCleaned(text: string): { removed: string[]; freeKb: number } {
  const removed: string[] = [];
  let freeKb = 0;
  for (const line of text.split("\n")) {
    const [kind, v] = line.trim().split("\t");
    if (kind === "removed" && v) removed.push(v);
    else if (kind === "free") freeKb = Number(v) || 0;
  }
  return { removed, freeKb };
}

export const gb = (kb: number) => `${Math.round(kb / 1024 / 1024)} GB`;

function ago(now: number, at: number): string {
  const h = Math.max(0, Math.round((now - at) / 3600));
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** One line on what went: `3 slots (merged: a, b; unused 3+ days: c)`. Empty when nothing went. */
export function cleanedLine(plan: CleanPlan, removed: string[], days: number): string {
  const went = plan.slots.filter((s) => removed.includes(s.name));
  if (!went.length) return "";
  const names = (reason: Reason) => {
    const n = went.filter((s) => s.reason === reason).map((s) => s.name);
    return n.length > 4 ? `${n.slice(0, 4).join(", ")} and ${n.length - 4} more` : n.join(", ");
  };
  const merged = names("merged");
  const unused = names("unused");
  const parts = [merged ? `merged: ${merged}` : "", unused ? `unused ${days}+ days: ${unused}` : ""].filter(Boolean);
  return `${went.length} slot${went.length === 1 ? "" : "s"} (${parts.join("; ")})`;
}

/** Why a run does not start, and what could still be freed: idle slots oldest first, then Docker's own. */
export function lowSpaceMessage(o: {
  host: string;
  freeKb: number;
  minGb: number;
  now: number;
  idle: { name: string; usedAt: number; kb?: number }[];
  docker: string[];
}): string {
  const idle = [...o.idle].sort((a, b) => a.usedAt - b.usedAt);
  const known = idle.reduce((n, s) => n + (s.kb ?? 0), 0);
  const lines = [
    `${o.host} has ${gb(o.freeKb)} free; a run needs ${o.minGb} GB (APX_REMOTE_MIN_FREE_GB). Nothing was started.`,
  ];
  if (idle.length) {
    lines.push(
      `pnpm remote clean --days 0 would free ${known ? `about ${gb(known)}` : "the slots"} of branches with no run going:`,
    );
    for (const s of idle) lines.push(`  ${s.name}  last run ${ago(o.now, s.usedAt)}${s.kb ? `  ${gb(s.kb)}` : ""}`);
  }
  if (o.docker.length)
    lines.push(
      "Docker could also free (images and build cache of everything on the machine, not only these runs):",
      ...o.docker.map((d) => `  ${d}`),
    );
  return lines.join("\n");
}

/** Sizes of the idle slots and what Docker could free, for `lowSpaceMessage`. Capped at two minutes. */
export function sizesScript(slots: string[]): string {
  const safe = slots.filter((s) => SAFE.test(s));
  return [
    `timeout 120 sh -c 'for s in ${safe.join(" ")}; do du -sk "slots/$s" 2>/dev/null; done' | sed 's/^/size\t/'`,
    `docker system df --format '{{.Type}}\t{{.Reclaimable}}' | sed 's/^/docker\t/'`,
  ].join("\n");
}

/** `size <kb> slots/<name>` and `docker <type> <reclaimable>` lines of `sizesScript`. */
export function parseSizes(text: string): { kb: Map<string, number>; docker: string[] } {
  const kb = new Map<string, number>();
  const docker: string[] = [];
  for (const line of text.split("\n")) {
    const [kind, a, b] = line.trim().split("\t");
    if (kind === "size" && a && b) kb.set(b.replace(/^slots\//, ""), Number(a) || 0);
    else if (kind === "docker" && a && b && !/^0B/.test(b) && /Images|Build Cache/.test(a)) docker.push(`${a}: ${b}`);
  }
  return { kb, docker };
}
