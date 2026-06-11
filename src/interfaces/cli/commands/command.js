// apx command — list and show workflow commands from .apc/commands/
import fs from "node:fs";
import path from "node:path";
import { findApfRoot } from "#core/apc/parser.js";
import { apcCommandsDir } from "#core/apc/paths.js";
import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

const commandsDir = apcCommandsDir;

function listCommandFiles(root) {
  const dir = commandsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

async function resolveCommandRoot(args = {}) {
  const explicitProject = args?.flags?.project;
  if (explicitProject !== undefined && explicitProject !== null && explicitProject !== "") {
    const pid = await resolveProjectId(explicitProject);
    const projects = await http.get("/projects");
    const project = projects.find((p) => p.id === pid);
    if (!project) throw new Error(`project ${pid} not found`);
    return project.path;
  }

  const root = findApfRoot();
  if (root) return root;

  const pid = await resolveProjectId();
  const projects = await http.get("/projects");
  const project = projects.find((p) => p.id === pid);
  if (!project) throw new Error(`project ${pid} not found`);
  return project.path;
}

export async function cmdCommandList(args = {}) {
  const root = await resolveCommandRoot(args);
  const files = listCommandFiles(root);
  if (files.length === 0) {
    console.log("(no commands — add .md files to .apc/commands/)");
    return;
  }
  for (const f of files) {
    const slug = f.replace(/\.md$/, "");
    const text = fs.readFileSync(path.join(commandsDir(root), f), "utf8");
    const firstLine = text.split("\n").find((l) => l.trim() && !l.startsWith("#"))
      || text.split("\n").find((l) => l.startsWith("# "))?.replace(/^#\s*/, "")
      || "";
    console.log(`  ${slug.padEnd(24)}  ${firstLine.slice(0, 60)}`);
  }
}

export async function cmdCommandShow(args) {
  const name = args._[0];
  if (!name) throw new Error("apx command show: missing <name>");
  const root = await resolveCommandRoot(args);
  const file = path.join(commandsDir(root), `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`command "${name}" not found in .apc/commands/`);
  process.stdout.write(fs.readFileSync(file, "utf8"));
}
