import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import zlib from "node:zlib";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { findSkillDirs, type GitRunner, importSkills, parseRepoUrl, previewSkills } from "./import.ts";
import { readZip, safeEntryPath } from "./zip.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let home = "";
let work = "";

const skill = (
  dir: string,
  name: string,
  body = `---\nname: ${name}\ndescription: ${name} does a thing.\n---\n\nHow.\n`,
) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), body);
};

/** A zip of the given entries (deflated), with unix modes so a link entry can be told apart. */
function zip(entries: Array<{ name: string; data?: string; mode?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const raw = Buffer.from(e.data ?? "");
    const packed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-import-"));
  work = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-src-"));
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(work);
});

test("a zip entry never leaves the folder it is read into; links and folders are not files", () => {
  assert.equal(safeEntryPath("../evil"), undefined);
  assert.equal(safeEntryPath("/etc/passwd"), undefined);
  assert.equal(safeEntryPath("C:\\Windows\\x"), undefined);
  assert.equal(safeEntryPath("a\\..\\..\\b"), undefined);
  assert.equal(safeEntryPath("./pdf/SKILL.md"), "pdf/SKILL.md");
  const { files, skipped } = readZip(
    zip([
      { name: "pdf/SKILL.md", data: "---\nname: pdf\n---\n" },
      { name: "pdf/../../escape.txt", data: "x" },
      { name: "pdf/link", data: "/etc/passwd", mode: 0o120777 },
    ]),
    { entries: 10, bytes: 1000 },
  );
  assert.deepEqual(
    files.map((f) => f.path),
    ["pdf/SKILL.md"],
  );
  assert.deepEqual(skipped, ["pdf/../../escape.txt", "pdf/link"]);
  assert.throws(() => readZip(Buffer.from("not a zip at all, just text"), { entries: 10, bytes: 10 }), /not a zip/);
  assert.throws(() => readZip(zip([{ name: "big", data: "x".repeat(50) }]), { entries: 10, bytes: 10 }), /more than/);
});

test("a zip is previewed with its notes, then only the picked skills are copied; nothing is left in the temp folder", async () => {
  const data = zip([
    { name: "pack/pdf/SKILL.md", data: "---\nname: pdf\ndescription: Reads PDFs.\nallowed-tools: Bash\n---\n" },
    { name: "pack/pdf/scripts/fill.py", data: "print(1)" },
    { name: "pack/notes/SKILL.md", data: "---\nname: notes\ndescription: Takes notes.\n---\n" },
    { name: "pack/apx-mcps/SKILL.md", data: "---\nname: apx-mcps\n---\n" },
  ]).toString("base64");
  const source = { kind: "zip" as const, name: "pack.zip", data };
  const temps = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("apx-skill-zip-")).length;
  const before = temps();
  const { candidates } = await env.client.call("skills.preview", { source, target: "global" });
  assert.deepEqual(
    candidates.map((c) => [c.id, c.name, c.status]),
    [
      ["pack/apx-mcps", "apx-mcps", "reserved"],
      ["pack/notes", "notes", "new"],
      ["pack/pdf", "pdf", "new"],
    ],
  );
  const pdf = candidates.find((c) => c.name === "pdf");
  assert.deepEqual(pdf?.notes, [
    { kind: "scripts", items: ["scripts/fill.py"] },
    { kind: "app_only", items: ["allowed-tools"] },
  ]);
  assert.equal(fs.existsSync(path.join(home, "skills", "pdf")), false, "a preview writes nothing");

  const r = await env.client.call("skills.import", { source, target: "global", pick: ["pack/pdf", "pack/apx-mcps"] });
  assert.deepEqual(
    r.imported.map((s) => [s.name, s.source]),
    [["pdf", "owner"]],
  );
  assert.deepEqual(r.skipped, [{ id: "pack/apx-mcps", reason: "apx-mcps is one of APX's own skills" }]);
  assert.equal(fs.readFileSync(path.join(home, "skills", "pdf", "scripts", "fill.py"), "utf8"), "print(1)");
  assert.equal(fs.existsSync(path.join(home, "skills", "notes")), false, "not picked");
  assert.equal(temps(), before, "the unpacked zip is removed");

  const again = await env.client.call("skills.import", { source, target: "global", pick: ["pack/pdf"] });
  assert.deepEqual(again.skipped, [{ id: "pack/pdf", reason: "pdf is already there" }]);
});

test("a folder's skill is copied without its links; replace swaps a link for a copy and never touches its target", async () => {
  const src = path.join(work, "lib");
  skill(src, "brief");
  fs.symlinkSync("/etc/hosts", path.join(src, "brief", "hosts"));
  const elsewhere = path.join(work, "elsewhere");
  skill(elsewhere, "brief", "---\nname: brief\ndescription: The linked one.\n---\n");
  fs.mkdirSync(path.join(home, "skills"), { recursive: true });
  fs.symlinkSync(path.join(elsewhere, "brief"), path.join(home, "skills", "brief"));

  const source = { kind: "folder" as const, path: path.join(src, "brief") };
  const { candidates } = await env.client.call("skills.preview", { source, target: "global" });
  assert.equal(candidates[0]?.status, "exists");
  assert.deepEqual(candidates[0]?.notes, [{ kind: "skipped", items: ["hosts"] }]);
  await env.client.call("skills.import", { source, target: "global", pick: ["."], replace: true });
  const dest = path.join(home, "skills", "brief");
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(dest, "hosts")), false);
  assert.match(fs.readFileSync(path.join(elsewhere, "brief", "SKILL.md"), "utf8"), /The linked one/);
});

test("a folder too big to be a skills folder is refused instead of walked", () => {
  const big = path.join(work, "big");
  for (let i = 0; i < 3001; i++) fs.mkdirSync(path.join(big, `d${i}`), { recursive: true });
  assert.throws(() => findSkillDirs(big), /holds too much/);
});

test("a project's skills land in .apc/skills, never through a link", async () => {
  const repo = realpath(fs.mkdtempSync(path.join(work, "repo-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.mkdirSync(path.join(repo, ".apc"));
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  const src = path.join(work, "proj-src");
  skill(src, "deploy");
  const source = { kind: "folder" as const, path: src };
  const r = await env.client.call("skills.import", { source, target: "project", project, pick: ["deploy"] });
  assert.deepEqual(
    r.imported.map((s) => [s.name, s.scope]),
    [["deploy", "project"]],
  );
  assert.ok(fs.existsSync(path.join(repo, ".apc", "skills", "deploy", "SKILL.md")));
  await removeDir(path.join(repo, ".apc", "skills"));
  fs.symlinkSync(work, path.join(repo, ".apc", "skills"));
  await assert.rejects(
    env.client.call("skills.import", { source, target: "project", project, pick: ["deploy"] }),
    /symlink/,
  );
});

test("a repository address: https or ssh only; a GitHub folder page clones its branch and reads that folder", async () => {
  assert.deepEqual(parseRepoUrl("https://github.com/acme/skills/tree/main/skills/pdf"), {
    clone: "https://github.com/acme/skills.git",
    ref: "main",
    sub: "skills/pdf",
  });
  assert.deepEqual(parseRepoUrl("https://github.com/acme/skills/blob/dev/pdf/SKILL.md"), {
    clone: "https://github.com/acme/skills.git",
    ref: "dev",
    sub: "pdf",
  });
  assert.deepEqual(parseRepoUrl("git@github.com:acme/skills.git"), { clone: "git@github.com:acme/skills.git" });
  for (const bad of [
    "file:///etc",
    "/tmp/repo",
    "ext::sh -c id",
    "http://example.com/x.git",
    "--upload-pack=x",
    "-oProxyCommand=x@host:y",
  ])
    assert.throws(() => parseRepoUrl(bad), /https:\/\/ or ssh/);

  const fixture = path.join(work, "remote");
  skill(path.join(fixture, "skills"), "pdf");
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    fs.cpSync(fixture, args.at(-1) as string, { recursive: true });
    return { code: 0, out: "" };
  };
  const target = { dir: path.join(work, "target") };
  const source = { kind: "repo" as const, url: "https://github.com/acme/skills/tree/main/skills" };
  const found = await previewSkills(source, target, git);
  assert.deepEqual(
    found.map((c) => c.id),
    ["pdf"],
  );
  const args = calls[0] ?? [];
  assert.ok(args.includes("protocol.allow=never") && args.includes("--depth"));
  assert.deepEqual(args.slice(args.indexOf("--branch"), args.indexOf("--branch") + 2), ["--branch", "main"]);
  assert.equal(args[args.indexOf("--") + 1], "https://github.com/acme/skills.git");
  const done = await importSkills(source, target, { pick: ["pdf"], replace: false }, git);
  assert.deepEqual(done.imported, [path.join(target.dir, "pdf")]);
  const failing: GitRunner = async () => ({ code: 128, out: "fatal: repository not found" });
  await assert.rejects(previewSkills(source, target, failing), /git clone failed: fatal: repository not found/);
});
