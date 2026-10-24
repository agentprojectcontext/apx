import assert from "node:assert/strict";
import { test } from "node:test";
import { check, isReleaseTag, parseArgs, type VerifyRun, verdict } from "./release-check.ts";

const SHA = "a".repeat(40);
const run = (over: Partial<VerifyRun> = {}): VerifyRun => ({
  databaseId: 1,
  status: "completed",
  conclusion: "success",
  url: "https://github.com/acme/apx/actions/runs/1",
  headSha: SHA,
  ...over,
});

test("only a commit whose newest verify run passed is verified", () => {
  assert.equal(verdict(SHA, [run()]).verified, true);
  // The newest run decides: a failed retry after a pass is not verified, a pass after a failure is.
  assert.equal(verdict(SHA, [run({ conclusion: "failure" }), run()]).verified, false);
  assert.equal(verdict(SHA, [run(), run({ conclusion: "failure" })]).verified, true);
  assert.match((verdict(SHA, []) as { reason: string }).reason, /no verify\.yml run/);
  assert.match((verdict(SHA, [run({ headSha: "b".repeat(40) })]) as { reason: string }).reason, /push it first/);
  const pending = verdict(SHA, [run({ status: "in_progress", conclusion: "" })]);
  assert.equal(pending.verified, false);
  assert.equal("pending" in pending && pending.pending?.databaseId, 1);
  assert.match((verdict(SHA, [run({ conclusion: "cancelled" })]) as { reason: string }).reason, /cancelled/);
});

test("arguments: a ref, --wait, --tag v2.x.y and --repo", () => {
  assert.deepEqual(parseArgs([]), { ref: "HEAD", wait: false, tag: undefined, repo: "agentprojectcontext/apx" });
  assert.deepEqual(parseArgs(["--tag", "v2.10.0", "main", "--wait", "--repo", "acme/apx"]), {
    ref: "main",
    wait: true,
    tag: "v2.10.0",
    repo: "acme/apx",
  });
  assert.throws(() => parseArgs(["--tag", "v1.2.3"]), /not a release tag/);
  assert.throws(() => parseArgs(["--tag"]), /needs a value/);
  assert.throws(() => parseArgs(["a", "b"]), /one ref/);
  assert.throws(() => parseArgs(["--force"]), /unknown flag/);
  assert.ok(isReleaseTag("v2.9.1"));
  assert.ok(!isReleaseTag("v2.9.1-beta"));
});

/** A fake git and gh: the commands asked for, answering from `runs`. */
function fake(runs: VerifyRun[][]) {
  const calls: string[] = [];
  const exec = (command: string, args: string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "git" && args[0] === "rev-parse") return { status: 0, stdout: `${SHA}\n`, stderr: "" };
    if (command === "gh" && args[1] === "list")
      return { status: 0, stdout: JSON.stringify(runs.shift() ?? []), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, exec };
}

test("an unverified commit is never tagged, and a verified one is tagged and pushed", () => {
  const failed = fake([[run({ conclusion: "failure" })]]);
  assert.equal(
    check(["--tag", "v2.10.0"], failed.exec, () => {}),
    1,
  );
  assert.ok(!failed.calls.some((c) => c.startsWith("git tag") || c.startsWith("git push")));
  // The run asked for is the commit's own on release/v2.
  assert.ok(failed.calls.some((c) => c.includes(`--branch release/v2 --commit ${SHA}`)));

  const passed = fake([[run()]]);
  assert.equal(
    check(["--tag", "v2.10.0"], passed.exec, () => {}),
    0,
  );
  assert.ok(passed.calls.includes(`git tag v2.10.0 ${SHA}`));
  assert.ok(passed.calls.includes("git push origin refs/tags/v2.10.0"));
});

test("--wait watches a run still going and decides on how it ended", () => {
  const going = fake([[run({ status: "in_progress", conclusion: "" })], [run()]]);
  assert.equal(
    check(["--wait"], going.exec, () => {}),
    0,
  );
  assert.ok(going.calls.some((c) => c.startsWith("gh run watch 1")));
  // Without --wait a run still going is not verified yet.
  assert.equal(
    check([], fake([[run({ status: "queued", conclusion: "" })]]).exec, () => {}),
    1,
  );
});
