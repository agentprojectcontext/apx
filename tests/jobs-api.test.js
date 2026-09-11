// GET /api/jobs — background work, as the panel reads it.
//
// A job is the one piece of an agent's state no other surface can show: a live
// TURN is in active-turns.js and the conversation GET carries it, a MESSAGE is
// in the ledger and the thread carries it, but "Ansel is waiting on Roby and has
// been since 17:31" is neither. Without this route the owner sees an agent that
// looks idle and a peer that looks dead — which is the picture the incident of
// 2026-09-11 produced for ten minutes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-jobs-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { register: registerJobs } = await import("../src/host/daemon/api/jobs.js");
const { openJob, closeJob, BACKGROUND_JOBS_DIR } = await import("#core/stores/background-jobs.js");

let base;
{
  const app = express();
  app.use(express.json());
  registerJobs(apiRouter(express, app));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  server.unref();
}

const get = async (url) => {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, body: await res.json() };
};

function fresh() {
  try { fs.rmSync(BACKGROUND_JOBS_DIR, { recursive: true, force: true }); } catch { /* nothing there */ }
}

test("the route answers with what is running, and says how much of it there is", async () => {
  fresh();
  const running = openJob({ project_id: 7, from: "ansel", to: "super_agent", body: "knot status", wake: true });
  const finished = openJob({ project_id: 7, from: "ansel", to: "jaro", body: "carwash" });
  closeJob(finished.id, { status: "done", result: "done it" });

  const all = await get("/jobs");
  assert.equal(all.status, 200);
  assert.equal(all.body.data.length, 2);
  // The count the panel draws its chip from.
  assert.equal(all.body.meta.open, 1);

  const open = await get("/jobs?open=1");
  assert.equal(open.body.data.length, 1);
  assert.equal(open.body.data[0].id, running.id);
  // Everything the chip needs to name the job, without a second request.
  assert.equal(open.body.data[0].to, "super_agent");
  assert.equal(open.body.data[0].from, "ansel");
  assert.equal(open.body.data[0].body, "knot status");
  assert.ok(open.body.data[0].created_at);
});

test("filters narrow by project, sender and status", async () => {
  fresh();
  openJob({ project_id: 7, from: "ansel", to: "roby" });
  openJob({ project_id: 9, from: "magui", to: "roby" });
  const failed = openJob({ project_id: 7, from: "ansel", to: "jaro" });
  closeJob(failed.id, { status: "failed", result: "never answered" });

  assert.equal((await get("/jobs?project_id=7")).body.data.length, 2);
  assert.equal((await get("/jobs?project_id=9")).body.data.length, 1);
  assert.equal((await get("/jobs?from=magui")).body.data.length, 1);

  const onlyFailed = await get("/jobs?status=failed");
  assert.equal(onlyFailed.body.data.length, 1);
  assert.equal(onlyFailed.body.data[0].result, "never answered");
});

test("one job by id, and a 404 that says so rather than an empty 200", async () => {
  fresh();
  const job = openJob({ project_id: 7, from: "ansel", to: "roby", body: "x" });

  const one = await get(`/jobs/${job.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.id, job.id);
  assert.equal(one.body.status, "running");

  const missing = await get("/jobs/bgjob_nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "job not found");
});

test("an id that is not one is refused, not walked out of the store directory", async () => {
  fresh();
  const out = await get("/jobs/..%2F..%2Fconfig");
  assert.equal(out.status, 404);
});

test("no jobs is an empty list, not an error", async () => {
  fresh();
  const out = await get("/jobs");
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.data, []);
  assert.equal(out.body.meta.open, 0);
});
