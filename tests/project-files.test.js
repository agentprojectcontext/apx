// Project file browser + docs editor — core store + daemon API.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import {
  listTree,
  readFile,
  writeFile,
  removeEntry,
  classifyKind,
  docsSubdir,
} from "#core/stores/project-files.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp(projects) {
  return buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
}

test("classifyKind maps extensions", () => {
  assert.equal(classifyKind("README.md"), "markdown");
  assert.equal(classifyKind("app.ts"), "text");
  assert.equal(classifyKind("logo.png"), "image");
  assert.equal(classifyKind("data.bin"), "binary");
});

test("docsSubdir defaults to docs and is sandboxed", () => {
  assert.equal(docsSubdir(undefined), "docs");
  assert.equal(docsSubdir({ docs: { root: "work" } }), "work");
  assert.equal(docsSubdir({ docs: { root: "../etc" } }), "etc");
});

test("listTree hides heavy dirs and dotfiles", () => {
  const root = makeTempProject({ name: "Files" });
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
    fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "x", "index.js"), "x");
    fs.mkdirSync(path.join(root, "vendor", "laravel"), { recursive: true });
    fs.writeFileSync(path.join(root, "vendor", "laravel", "framework.php"), "<?php");
    fs.writeFileSync(path.join(root, ".secret"), "nope");

    const { tree } = listTree(root);
    const names = tree.map((n) => n.name);
    assert.ok(names.includes("src"));
    assert.ok(!names.includes("node_modules"));
    assert.ok(!names.includes("vendor"));
    assert.ok(!names.includes(".secret"));
    const src = tree.find((n) => n.name === "src");
    assert.equal(src.type, "dir");
    assert.equal(src.children[0].name, "a.ts");
  } finally {
    cleanupTempProject(root);
  }
});

test("listTree lists a folder's own files, not just its subdirs", () => {
  // Regression: root-level files must appear even when directories (which sort
  // first) contain nested content. Mirrors a Laravel layout where composer.json
  // and artisan live beside app/, config/, vendor/, …
  const root = makeTempProject({ name: "FilesRoot" });
  try {
    for (const d of ["app", "config", "routes"]) {
      fs.mkdirSync(path.join(root, d, "sub"), { recursive: true });
      fs.writeFileSync(path.join(root, d, "sub", "nested.php"), "<?php");
    }
    fs.writeFileSync(path.join(root, "composer.json"), "{}");
    fs.writeFileSync(path.join(root, "artisan"), "#!/usr/bin/env php");

    const { tree } = listTree(root);
    const names = tree.map((n) => n.name);
    assert.ok(names.includes("composer.json"), "root file composer.json listed");
    assert.ok(names.includes("artisan"), "root file artisan listed");
    // Dirs still sort before files at each level.
    assert.deepEqual(
      tree.filter((n) => n.type === "dir").map((n) => n.name),
      ["app", "config", "routes"],
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("writeFile + readFile round-trip and create parent dirs", () => {
  const root = makeTempProject({ name: "Files2" });
  try {
    writeFile(root, "docs/spec/intro.md", "# Intro\n", { subdir: "docs" });
    // The file physically lands under <root>/docs/docs/... because subdir was
    // "docs" and the path was "docs/spec/intro.md". Use no subdir + full path:
    writeFile(root, "guide.md", "# Guide\n");
    const f = readFile(root, "guide.md");
    assert.equal(f.kind, "markdown");
    assert.equal(f.encoding, "utf8");
    assert.equal(f.content, "# Guide\n");
  } finally {
    cleanupTempProject(root);
  }
});

test("readFile/writeFile refuse to escape the project root", () => {
  const root = makeTempProject({ name: "Files3" });
  try {
    assert.throws(() => readFile(root, "../../../etc/passwd"));
    assert.throws(() => writeFile(root, "../evil.txt", "x"));
  } finally {
    cleanupTempProject(root);
  }
});

test("fs API serves tree, file read/write, and docs scope", async () => {
  const root = makeTempProject({ name: "FilesApi" });
  fs.writeFileSync(path.join(root, "README.md"), "# Hello\n");
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const app = makeApp(projects);
  const { server, baseUrl } = await listen(app);
  try {
    // Whole-project tree.
    let res = await fetch(`${baseUrl}/projects/${id}/fs/tree?scope=project`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.scope, "project");
    assert.ok(body.tree.find((n) => n.name === "README.md"));

    // Read a file.
    res = await fetch(`${baseUrl}/projects/${id}/fs/file?path=README.md`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.content, "# Hello\n");

    // Write into the docs scope; it should land under <root>/docs/.
    res = await fetch(`${baseUrl}/projects/${id}/fs/file`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "docs", path: "cases/one.md", content: "# Case One\n" }),
    });
    assert.equal(res.status, 200);
    assert.ok(fs.existsSync(path.join(root, "docs", "cases", "one.md")));

    // Docs tree sees it.
    res = await fetch(`${baseUrl}/projects/${id}/fs/tree?scope=docs`);
    body = await res.json();
    const cases = body.tree.find((n) => n.name === "cases");
    assert.ok(cases);
    assert.equal(cases.children[0].name, "one.md");

    // Traversal is rejected with 400.
    res = await fetch(`${baseUrl}/projects/${id}/fs/file?path=${encodeURIComponent("../../../etc/passwd")}`);
    assert.equal(res.status, 400);

    // Delete.
    res = await fetch(`${baseUrl}/projects/${id}/fs/entry?scope=docs&path=${encodeURIComponent("cases/one.md")}`, {
      method: "DELETE",
    });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(path.join(root, "docs", "cases", "one.md")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanupTempProject(root);
  }
});

test("removeEntry refuses to delete the root", () => {
  const root = makeTempProject({ name: "Files4" });
  try {
    assert.throws(() => removeEntry(root, ""));
  } finally {
    cleanupTempProject(root);
  }
});
