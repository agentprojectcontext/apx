// apx command — list and show workflow commands from .apc/commands/
import fs from "node:fs";
import path from "node:path";
import { findApfRoot } from "../../core/parser.js";

function commandsDir(root) {
  return path.join(root, ".apc", "commands");
}

function listCommandFiles(root) {
  const dir = commandsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
}

export function cmdCommandList() {
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project");
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

export function cmdCommandShow(args) {
  const name = args._[0];
  if (!name) throw new Error("apx command show: missing <name>");
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project");
  const file = path.join(commandsDir(root), `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`command "${name}" not found in .apc/commands/`);
  process.stdout.write(fs.readFileSync(file, "utf8"));
}
