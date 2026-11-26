// The steps browser_do runs: controls found by what the page shows, waits measured on an injected clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type BrowserStep, fill, find, runSteps, type StepPage, variablesOf } from "./browser-steps.ts";

const PAGE = [
  '<untrusted_web source="https://www.example.com/admin">',
  '- button "Create post" [e1]',
  '- dialog "New post"',
  '  - textbox "Write something" [e2]',
  '  - button "Schedule" [e3]',
  '  - button "Next" [e4]',
  '- dialog "Schedule post"',
  '  - textbox "Date" [e5] = "23/11/2026"',
  '  - button "Next" [e6]',
  '- link "Help" <https://www.example.com/help> [e7]',
  "</untrusted_web>",
].join("\n");

test("a control is found by role and name, by name alone, or by part of its name", () => {
  assert.deepEqual(find(PAGE, 'button "Create post"'), { ref: "e1" });
  assert.deepEqual(find(PAGE, "Write something"), { ref: "e2" });
  assert.deepEqual(find(PAGE, "write some"), { ref: "e2" });
  assert.deepEqual(find(PAGE, 'textbox "Date"'), { ref: "e5" });
  assert.deepEqual(find(PAGE, 'link "Help"'), { ref: "e7" });
  assert.deepEqual(find(PAGE, 'button "Publish"'), { missing: true });
});

test("a name that repeats asks for within, and within picks the one inside that dialog", () => {
  assert.deepEqual(find(PAGE, 'button "Next"'), { many: ['button "Next"', 'button "Next"'] });
  assert.deepEqual(find(PAGE, 'button "Next"', 'dialog "Schedule post"'), { ref: "e6" });
  assert.deepEqual(find(PAGE, 'button "Next"', 'dialog "New post"'), { ref: "e4" });
  assert.deepEqual(find(PAGE, 'button "Next"', 'dialog "Missing"'), { missing: true });
});

test("an exact name wins over names that only contain it", () => {
  const tree = '- button "Schedule" [e1]\n- button "Schedule post later" [e2]';
  assert.deepEqual(find(tree, "Schedule"), { ref: "e1" });
});

test("variables fill every string of a step, and none is half-filled", () => {
  const steps: BrowserStep[] = [
    { do: "open", url: "https://example.com/{{page}}" },
    { do: "type", target: 'textbox "Date"', text: "{{ date }}" },
  ];
  assert.deepEqual(variablesOf(steps), ["page", "date"]);
  assert.deepEqual(fill(steps, { page: "admin" }), { missing: ["date"] });
  assert.deepEqual(fill(steps, { page: "admin", date: "30/11/2026" }), {
    steps: [
      { do: "open", url: "https://example.com/admin" },
      { do: "type", target: 'textbox "Date"', text: "30/11/2026" },
    ],
  });
});

/** A page on a clock that moves only when the steps sleep. */
function fakePage(tree: string, onClick: (ref: string) => void = () => {}) {
  let clock = 0;
  const calls: string[] = [];
  const page: StepPage = {
    snapshot: async () => tree,
    text: async () => "Scheduled: Hello on 30/11/2026",
    click: async (ref) => {
      calls.push(`click ${ref}`);
      onClick(ref);
    },
    type: async (ref, text, submit) => {
      calls.push(`type ${ref} ${text}${submit ? " +enter" : ""}`);
    },
    open: async (url) => {
      calls.push(`open ${url}`);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { page, calls, at: () => clock };
}

test("steps run in order, each waiting for its control, and the log says what was done", async () => {
  let tree = '- button "Create post" [e1]';
  const shown: string[] = [];
  const { page, calls } = fakePage("", (ref) => {
    if (ref === "e1") shown.push("dialog");
  });
  let polls = 0;
  page.snapshot = async () => {
    polls++;
    // The dialog shows up two looks after the click, as a slow page would.
    if (shown.length && polls > 3) tree = PAGE;
    return tree;
  };
  const out = await runSteps(
    [
      { do: "click", target: 'button "Create post"' },
      { do: "type", target: "Write something", text: "Hello" },
      { do: "click", target: 'button "Next"', within: 'dialog "New post"' },
    ],
    page,
  );
  assert.equal(out.failed, undefined);
  assert.deepEqual(calls, ["click e1", "type e2 Hello", "click e4"]);
  assert.deepEqual(out.done, [
    '1. click button "Create post"',
    "2. type «Hello» in Write something",
    '3. click button "Next" in dialog "New post"',
  ]);
});

test("a control that never shows stops the steps after its wait, with the page to fix them", async () => {
  const { page, calls, at } = fakePage(PAGE);
  const out = await runSteps(
    [
      { do: "click", target: 'button "Create post"' },
      { do: "click", target: 'button "Publish"' },
      { do: "click", target: 'button "Schedule"' },
    ],
    page,
  );
  assert.deepEqual(calls, ["click e1"]);
  assert.equal(out.failed?.step, 2);
  assert.match(out.failed?.why ?? "", /no control button "Publish"/);
  assert.match(out.failed?.tree ?? "", /Create post/);
  assert.ok(at() >= 10_000, "it waited the full find timeout on the injected clock");
});

test("a repeated name stops with the names it matched, so the agent can add within", async () => {
  const { page } = fakePage(PAGE);
  const out = await runSteps([{ do: "click", target: 'button "Next"' }], page);
  assert.match(out.failed?.why ?? "", /more than one control.*within/);
});

test("wait stops when a text never shows, and passes once a text is gone", async () => {
  const { page } = fakePage(PAGE);
  const never = await runSteps([{ do: "wait", text: "Scheduled for", timeout_s: 2 }], page);
  assert.equal(never.failed?.step, 1);
  assert.match(never.failed?.why ?? "", /never showed/);
  const gone = await runSteps([{ do: "wait", text: "Save as draft?", gone: true }], page);
  assert.equal(gone.failed, undefined);
  // Plain text the snapshot leaves out is read from the page's visible text.
  const text = await runSteps([{ do: "wait", text: "Scheduled: Hello" }], page);
  assert.equal(text.failed, undefined);
});

test("an error from the browser stops at that step and says it", async () => {
  const { page } = fakePage(PAGE);
  page.click = async () => {
    throw new Error("tab c7 is being used by another agent; open your own tab");
  };
  const out = await runSteps([{ do: "click", target: "Create post" }], page);
  assert.deepEqual(out, {
    done: [],
    failed: { step: 1, why: "tab c7 is being used by another agent; open your own tab" },
  });
});
