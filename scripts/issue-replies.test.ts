import assert from "node:assert/strict";
import { test } from "node:test";
import { fixesIn, replyFor } from "./issue-replies.ts";

test("each Issue trailer names one fix; a commit without one names none", () => {
  const log = [
    "abc1234\0fix(core): a chat turn gets 60 steps\0#105\x1e",
    "def5678\0feat(web): mark all read from the Inbox\0#107,#106\x1e",
    "0a1b2c3\0chore: tidy\0\x1e",
  ].join("\n");
  assert.deepEqual(fixesIn(log), [
    { issue: 105, sha: "abc1234", subject: "fix(core): a chat turn gets 60 steps" },
    { issue: 107, sha: "def5678", subject: "feat(web): mark all read from the Inbox" },
    { issue: 106, sha: "def5678", subject: "feat(web): mark all read from the Inbox" },
  ]);
});

test("the reply says the version, each commit as a sentence, and how to update", () => {
  const body = replyFor("v2.3.28", [
    { issue: 105, sha: "abc1234", subject: "fix(core): a chat turn gets 60 steps" },
    { issue: 105, sha: "9f8e7d6", subject: "fix: apx chat shows the step limit" },
  ]);
  assert.match(body, /^Released in APX v2\.3\.28:/);
  assert.match(body, /- A chat turn gets 60 steps \(abc1234\)/);
  assert.match(body, /- apx chat shows the step limit \(9f8e7d6\)/);
  assert.match(body, /apx upgrade/);
  assert.match(body, /releases\/tag\/v2\.3\.28/);
});
