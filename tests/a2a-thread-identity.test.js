// One exchange, one thread — whatever the model called the other agent.
//
// `resolvePeer` accepts a display name on purpose: the tool's own description
// tells a model to use "an agent slug from list_agents", and a model that has
// just read a roster of names will sometimes say `Zoya`. The RECIPIENT was
// canonicalised for that reason; the SENDER never was, on the tool path.
//
// So an exchange could end up in two threads at once:
//   · `ceo~cfo`  — two faces, a proper title, everything resolves
//   · `cfo~zoya` — a letter for an avatar and a raw slug where a name should be,
//                  because nothing in the roster is called `zoya`
//
// The background path is where it bites hardest: `deliverWake` writes back with
// `from = job.to`, which is whatever string the model typed when it opened the
// job. So the ANSWER to a piece of work lands somewhere other than the request.
//
// The HTTP route fixed this at its own door (1975c64, `senderAddress`); the tool
// path and the job record were left behind. Same rule, three places, one call.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2aid-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { a2aThreadId } = await import("#core/stores/messages.js");
const { readJob, BACKGROUND_JOBS_DIR } = await import("#core/stores/background-jobs.js");
const { sendInBackground } = await import("#core/agent/a2a/background.js");

/** A project on disk with two agents whose names are not their slugs — which is
 *  the whole condition for this bug and, since the executive layer, the normal
 *  case rather than an exotic one. */
function project() {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  const write = (slug, name) =>
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      `---\nname: ${name}\nrole: ${name}\n---\n\nYou are ${name}.\n`,
    );
  write("ceo", "Zoya");
  write("cfo", "Blake");
  return { id: 1, name: "appsi", path: root, storagePath: path.join(root, ".store"), config: {} };
}

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

test("a job opened by display name is filed under the slugs", async () => {
  fresh();
  const p = project();
  const out = sendInBackground({
    project: p,
    // Both ends spelled the way a model that just read the roster says them.
    from: "Blake",
    to: "Zoya",
    body: "armá el scorecard",
    wake: true,
    messagePeerFn: async () => ({ text: "ok" }),
  });
  assert.equal(out.ok, true);
  const job = readJob(out.job_id);
  assert.equal(job.to, "ceo", "the record names the agent, not the label");
  assert.equal(job.from, "cfo", "and so does the sender — this half was the bug");
  assert.equal(job.thread, a2aThreadId("cfo", "ceo"));
  assert.equal(job.thread, "ceo~cfo", "and the pair sorts, so both directions agree");
});

test("the work goes out under the same names the record uses", async () => {
  fresh();
  const p = project();
  const sent = [];
  sendInBackground({
    project: p,
    from: "Blake",
    to: "Zoya",
    body: "armá el scorecard",
    wake: false,
    messagePeerFn: async (args) => { sent.push(args); return { text: "ok" }; },
  });
  // The detached arm runs on a microtask; let it.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ceo", "not `Zoya`, or the reply files itself elsewhere");
  assert.equal(sent[0].from, "cfo", "not `Blake`, for the same reason");
});

test("the fan-out wall counts the sender's own jobs", async () => {
  // The count asks "how many are open for this sender" and jobs are filed under
  // the canonical name, so it has to resolve BEFORE counting — otherwise a
  // caller spelling itself any other way counts zero of its own and walks
  // straight through the limit.
  fresh();
  const p = project();
  const open = (from) => sendInBackground({
    project: p, from, to: "ceo", body: "x", wake: false,
    messagePeerFn: async () => new Promise(() => {}),   // never settles: stays open
  });
  // MIXED SPELLINGS on purpose — the same agent, named three ways. Unresolved,
  // these are three different senders with one job each and the wall never
  // closes.
  assert.equal(open("cfo").ok, true);
  assert.equal(open("Blake").ok, true);
  assert.equal(open("blake").ok, true);
  const fourth = open("Blake");
  assert.ok(fourth.error, "the fourth is refused, however it spells itself");
  assert.match(fourth.error, /already have 3 jobs running/);
});

test("messagePeer canonicalises both ends, not just the recipient", () => {
  // Source contract: the fix is one call and it is easy to drop in a refactor,
  // and the symptom (a second thread appearing days later) is nobody's first
  // suspect.
  const src = fs.readFileSync(new URL("../src/core/agent/a2a/delegate.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function messagePeer"));
  assert.match(fn, /const sender = senderAddress\(from, agents, config\) \|\| from;/);
  assert.match(fn, /const thread = a2aThreadId\(sender, address\);/);
  // …and every row it writes uses the resolved pair, or the thread is right and
  // its contents still name somebody the roster has never heard of.
  assert.doesNotMatch(fn.slice(0, fn.indexOf("return {")), /author: from\b/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("return {")), /agent_slug: from\b/);
});
