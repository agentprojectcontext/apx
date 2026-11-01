import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, tempDir, waitFor } from "../testkit/platform.ts";
import { createProjectReader, type ProjectFiles, readProjectFiles } from "./project-reader.ts";
import { PROJECT_READ_MS } from "./sync.ts";

function makeProject(root: string, name: string) {
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "ceo.md"),
    "---\nname: Ceo\nrole: Chief Executive\n---\n\nDecide.\n",
  );
}

// A FIFO holds open() until a writer comes, like a macOS privacy prompt holds a read: a real held read.
const FIFO = process.platform !== "win32";

/** Holds reads of `file` where the system has FIFOs; the release lets the held read finish and leaves a plain file. */
function hold(file: string): () => void {
  if (!FIFO) {
    fs.writeFileSync(file, "");
    return () => {};
  }
  execFileSync("mkfifo", [file]);
  return () => {
    fs.writeFileSync(file, "");
    // The folder's watcher reads it again: a plain file, not a FIFO with no writer.
    fs.writeFileSync(`${file}.tmp`, "");
    fs.renameSync(`${file}.tmp`, file);
  };
}

const health = (url: string) =>
  new Promise<number>((resolve, reject) => {
    http
      .get(`${url}/health`, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject);
  });

/** A home with two registered projects, its core closed again: the next start reads both folders. */
async function homeWithProjects() {
  const ok = tempDir("apx-load-ok-");
  const held = tempDir("apx-load-held-");
  makeProject(ok.path, "Acme");
  makeProject(held.path, "Northwind");
  const first = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const okId = (await first.client.call("projects.register", { path: ok.path })).project.id;
  const heldId = (await first.client.call("projects.register", { path: held.path })).project.id;
  await first.core.close();
  return {
    home: first.home,
    ok,
    held,
    okId,
    heldId,
    async remove() {
      await first.cleanup();
      await ok.remove();
      await held.remove();
    },
  };
}

test("a project folder that never answers does not keep the core from starting; its late answer still lands", async () => {
  const h = await homeWithProjects();
  const timers = manualTimers();
  let answer: (files: ProjectFiles) => void = () => {};
  const reads: string[] = [];
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: h.home,
    runTimers: timers,
    projectRead: async (root) => {
      reads.push(root);
      return root === h.held.path ? new Promise<ProjectFiles>((r) => (answer = r)) : readProjectFiles(root);
    },
  });
  const project = async (id: string) => (await env.client.call("projects.list", {})).projects.find((p) => p.id === id);
  try {
    assert.equal(await health(env.core.url), 200, "the core answers while a folder is held");
    await waitFor(() => reads.includes(h.held.path), "the held folder's read");
    // Until its deadline the project shows as it was at the last start.
    assert.equal((await project(h.heldId))?.present, true);
    assert.equal((await project(h.okId))?.present, true);

    timers.tick(PROJECT_READ_MS);
    const waiting = await waitFor(async () => {
      const p = await project(h.heldId);
      return p?.unreadable === "waiting" && p;
    }, "the held project to show as waiting");
    assert.equal(waiting.present, false);
    assert.equal((await project(h.okId))?.unreadable, undefined, "the other project is unaffected");
    assert.equal(await health(env.core.url), 200);

    // The owner answers the prompt: the read finishes and the project is back.
    answer(readProjectFiles(h.held.path));
    const back = await waitFor(async () => {
      const p = await project(h.heldId);
      return p?.present && p;
    }, "the held project to be read");
    assert.equal(back.unreadable, undefined);
    assert.equal(back.name, "Northwind");
  } finally {
    await env.core.close();
    await h.remove();
  }
});

test("a project folder the system refuses shows as denied, the others load", async () => {
  const h = await homeWithProjects();
  const env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: h.home,
    projectRead: async (root) => (root === h.held.path ? { state: "denied" } : readProjectFiles(root)),
  });
  try {
    const denied = await waitFor(async () => {
      const p = (await env.client.call("projects.list", {})).projects.find((x) => x.id === h.heldId);
      return p?.unreadable === "denied" && p;
    }, "the refused project to show as denied");
    assert.equal(denied.present, false);
    const ok = (await env.client.call("projects.list", {})).projects.find((x) => x.id === h.okId);
    assert.equal(ok?.present, true);
    assert.equal(ok?.unreadable, undefined);
  } finally {
    await env.core.close();
    await h.remove();
  }
});

test("the reader's threads keep a held read from holding up the next one", async () => {
  const held = tempDir("apx-reader-held-");
  const ok = tempDir("apx-reader-ok-");
  const reader = createProjectReader();
  try {
    makeProject(held.path, "Northwind");
    makeProject(ok.path, "Acme");
    const release = hold(path.join(held.path, "AGENTS.md"));
    let heldDone = false;
    const heldRead = reader.read(held.path).finally(() => {
      heldDone = true;
    });
    const files = await reader.read(ok.path);
    assert.equal(files.state === "read" && files.project.name, "Acme");
    if (FIFO) assert.equal(heldDone, false, "the held read is still waiting");
    release();
    const late = await heldRead;
    assert.equal(late.state === "read" && late.project.name, "Northwind");
  } finally {
    reader.close();
    await held.remove();
    await ok.remove();
  }
});

test("a core whose project read is held still starts and answers", async () => {
  const h = await homeWithProjects();
  const release = hold(path.join(h.held.path, "AGENTS.md"));
  const timers = manualTimers();
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), home: h.home, runTimers: timers });
  const project = async () => (await env.client.call("projects.list", {})).projects.find((x) => x.id === h.heldId);
  try {
    assert.equal(await health(env.core.url), 200);
    if (FIFO)
      await waitFor(async () => {
        timers.tick(PROJECT_READ_MS);
        return (await project())?.unreadable === "waiting";
      }, "the held project to show as waiting");
    // The prompt is answered: the held read finishes and the project is read.
    release();
    await waitFor(async () => {
      const p = await project();
      return p?.present && !p.unreadable;
    }, "the held project to be read");
  } finally {
    await env.core.close();
    await h.remove();
  }
});

test("a folder that is gone reads as missing", async () => {
  const dir = tempDir("apx-reader-gone-");
  const gone = path.join(dir.path, "gone");
  try {
    assert.deepEqual(readProjectFiles(gone), { state: "missing" });
    fs.mkdirSync(gone);
    assert.deepEqual(readProjectFiles(gone), { state: "missing" }, "a folder that is no project");
  } finally {
    await dir.remove();
  }
});
