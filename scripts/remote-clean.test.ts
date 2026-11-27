import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanedLine,
  cleanScript,
  emptyTrashScript,
  type Facts,
  lowSpaceMessage,
  parseCleaned,
  parseFacts,
  parseSizes,
  planClean,
} from "./remote-clean.ts";

const DAY = 86_400;
const now = 1_800_000_000;

function facts(over: Partial<Facts> = {}): Facts {
  return { now, freeKb: 100 * 1024 * 1024, slots: [], boxes: [], ...over };
}

test("the machine's facts are read line by line, and a name unsafe for a shell is dropped", () => {
  const f = parseFacts(
    [
      `now\t${now}`,
      "free\t182452224",
      `slot\tfeat-inbox\t${now - 60}\t1`,
      `slot\tfix-old\t${now - 5 * DAY}\t0`,
      `slot\tbad;rm -rf\t${now}\t1`,
      "box\tfeat-inbox\tfalse\t2027-01-15T08:00:00.123456789Z",
      "box\tfix-live\ttrue\t0001-01-01T00:00:00Z",
      "garbage line",
    ].join("\n"),
  );
  assert.equal(f.now, now);
  assert.equal(f.freeKb, 182452224);
  assert.deepEqual(
    f.slots.map((s) => [s.name, s.merged]),
    [
      ["feat-inbox", true],
      ["fix-old", false],
    ],
  );
  assert.deepEqual(f.boxes, [
    { slot: "feat-inbox", running: false, endedAt: Math.floor(Date.parse("2027-01-15T08:00:00.123Z") / 1000) },
    { slot: "fix-live", running: true, endedAt: 0 },
  ]);
});

test("a merged slot and one unused for longer than the days go; a recent unmerged one stays", () => {
  const plan = planClean(
    facts({
      slots: [
        { name: "feat-merged", usedAt: now - 3600, merged: true },
        { name: "fix-stale", usedAt: now - 4 * DAY, merged: false },
        { name: "fix-fresh", usedAt: now - 2 * DAY, merged: false },
      ],
    }),
    { days: 3 },
  );
  assert.deepEqual(
    plan.slots.map((s) => [s.name, s.reason]),
    [
      ["feat-merged", "merged"],
      ["fix-stale", "unused"],
    ],
  );
});

test("the slot this run uses and any slot whose box runs stay, however old or merged", () => {
  const plan = planClean(
    facts({
      slots: [
        { name: "fix-mine", usedAt: now - 30 * DAY, merged: true },
        { name: "fix-busy", usedAt: now - 30 * DAY, merged: true },
      ],
      boxes: [{ slot: "fix-busy", running: true, endedAt: 0 }],
    }),
    { keep: "fix-mine", days: 3 },
  );
  assert.deepEqual(plan, { slots: [], boxes: [] });
});

test("the target branch's own slot is not removed for being merged, only for its age", () => {
  const f = facts({
    slots: [
      { name: "staging", usedAt: now - DAY, merged: true },
      { name: "main", usedAt: now - 10 * DAY, merged: true },
    ],
  });
  const plan = planClean(f, { days: 3, longLived: ["staging", "main"] });
  assert.deepEqual(
    plan.slots.map((s) => [s.name, s.reason]),
    [["main", "unused"]],
  );
});

test("days 0 removes every idle slot", () => {
  const plan = planClean(facts({ slots: [{ name: "fix-a", usedAt: now - 60, merged: false }] }), { days: 0 });
  assert.deepEqual(
    plan.slots.map((s) => s.name),
    ["fix-a"],
  );
});

test("a finished box goes with its slot, without a slot, or a day after it ended; a running one never", () => {
  const plan = planClean(
    facts({
      slots: [
        { name: "feat-merged", usedAt: now, merged: true },
        { name: "fix-recent", usedAt: now, merged: false },
        { name: "fix-old-box", usedAt: now, merged: false },
        { name: "fix-live", usedAt: now, merged: false },
      ],
      boxes: [
        { slot: "feat-merged", running: false, endedAt: now - 60 },
        { slot: "fix-recent", running: false, endedAt: now - 3600 },
        { slot: "fix-old-box", running: false, endedAt: now - 2 * DAY },
        { slot: "gone-slot", running: false, endedAt: now - 60 },
        { slot: "fix-live", running: true, endedAt: 0 },
      ],
    }),
    { days: 3 },
  );
  assert.deepEqual(plan.boxes, ["feat-merged", "fix-old-box", "gone-slot"]);
});

test("the cleanup re-checks each slot under its lock, against the use time it was chosen with", () => {
  const f = facts({ slots: [{ name: "fix-a", usedAt: now - 5 * DAY, merged: false }] });
  const script = cleanScript(planClean(f, { days: 3 }), f, "20gb");
  assert.match(script, new RegExp(`^gone fix-a ${now - 5 * DAY}$`, "m"));
  assert.match(script, /flock -n 9/);
  assert.match(script, /docker builder prune -f --max-used-space 20gb/);
  // Deleting the moved slots is millions of files: it runs in the background, one deleter at a time.
  assert.match(script, /^nohup setsid flock -n locks\/trash\.lock /m);
  assert.match(emptyTrashScript(), /^timeout 1800 flock locks\/trash\.lock /m);
  // An unsafe name never reaches the shell, even if a plan carried one.
  const bad = cleanScript({ slots: [{ name: "x; rm -rf ~", usedAt: 0, reason: "unused" }], boxes: ["y z"] }, f, "1gb");
  assert.doesNotMatch(bad, /rm -rf ~|apx-y z/);
});

test("what went is said in one line, and only what was really removed", () => {
  const plan = planClean(
    facts({
      slots: [
        { name: "feat-a", usedAt: now, merged: true },
        { name: "fix-b", usedAt: now - 9 * DAY, merged: false },
        { name: "fix-c", usedAt: now - 9 * DAY, merged: false },
      ],
    }),
    { days: 3 },
  );
  const { removed, freeKb } = parseCleaned("removed\tfeat-a\nremoved\tfix-b\nfree\t1048576\n");
  assert.equal(freeKb, 1048576);
  assert.equal(cleanedLine(plan, removed, 3), "2 slots (merged: feat-a; unused 3+ days: fix-b)");
  assert.equal(cleanedLine(plan, [], 3), "");
  const many = planClean(
    facts({ slots: ["a", "b", "c", "d", "e", "f"].map((n) => ({ name: `fix-${n}`, usedAt: now, merged: true })) }),
    { days: 3 },
  );
  assert.equal(
    cleanedLine(
      many,
      many.slots.map((s) => s.name),
      3,
    ),
    "6 slots (merged: fix-a, fix-b, fix-c, fix-d and 2 more)",
  );
});

test("a refusal says how much is free, what is needed and what could be freed, oldest first", () => {
  const sizes = parseSizes(
    [
      "size\t15728640\tslots/fix-new",
      "size\t14680064\tslots/fix-old",
      "docker\tImages\t52.32GB (75%)",
      "docker\tBuild Cache\t0B",
      "docker\tContainers\t1GB (5%)",
    ].join("\n"),
  );
  const message = lowSpaceMessage({
    host: "box",
    freeKb: 20 * 1024 * 1024,
    minGb: 40,
    now,
    idle: [
      { name: "fix-new", usedAt: now - 3 * 3600, kb: sizes.kb.get("fix-new") },
      { name: "fix-old", usedAt: now - 2 * DAY - 3600, kb: sizes.kb.get("fix-old") },
    ],
    docker: sizes.docker,
  });
  assert.match(message, /^box has 20 GB free; a run needs 40 GB/);
  assert.match(message, /pnpm remote clean --days 0 would free about 29 GB/);
  assert.ok(message.indexOf("fix-old") < message.indexOf("fix-new"));
  assert.match(message, /fix-new {2}last run 3 h ago {2}15 GB/);
  assert.match(message, /fix-old {2}last run 2 days ago/);
  assert.match(message, /Images: 52\.32GB/);
  assert.doesNotMatch(message, /Build Cache|Containers/);
});
