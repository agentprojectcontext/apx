// Reading an APC project from disk: AGENTS.md + .apc/ (project.json, agents/<slug>.md). The files are the source of
// truth for definitions; the core keeps an index in its database. Read-only: nothing here writes the repo.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Fields, listField, parseFrontmatter, textField } from "./frontmatter.ts";

export const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
/** AGENTS.md is project context for its agents; past this size the head and tail are kept. */
const AGENTS_MD_CAP = 12_000;
/** .apc/memory.md, the owner's notes for the project's agents. */
const MEMORY_MD_CAP = 6_000;

export type ApcProject = {
  /** Stable id: the committed apx_id when there is one, else derived from the path. */
  id: string;
  /** Derived from the folder's path: used when another folder already holds the same apx_id (clone, worktree). */
  pathId: string;
  root: string;
  name: string;
  description?: string | undefined;
  kind?: string | undefined;
  /** AGENTS.md, capped. */
  context?: string | undefined;
  /** .apc/memory.md (written by the owner), capped. */
  memory?: string | undefined;
};

export type ApcAgent = {
  slug: string;
  name: string;
  role: string;
  description?: string | undefined;
  /** The file's body: the agent's own instructions. */
  prompt: string;
  /** v1's "model" field as written ("inherit", "provider:model", a bare id). */
  model?: string | undefined;
  parent?: string | undefined;
  icon?: string | undefined;
  emoji?: string | undefined;
  skills: string[];
  tools: string[];
  aliases: string[];
  fields: Fields;
};

/**
 * Reads a project file, refusing symlinks: a repo must not be able to pull any other file of the machine into an
 * agent's prompt.
 */
const readText = (file: string): string | undefined => {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
};

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

function cap(text: string, max = AGENTS_MD_CAP, name = "AGENTS.md"): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  return `${text.slice(0, head)}\n\n[… ${text.length - max} chars of ${name} omitted …]\n\n${text.slice(-(max - head))}`;
}

/** Whether a folder is an APC project (has .apc/ or AGENTS.md). */
export function isApcProject(root: string): boolean {
  return fs.existsSync(path.join(root, ".apc")) || fs.existsSync(path.join(root, "AGENTS.md"));
}

export function readProject(root: string): ApcProject {
  const abs = path.resolve(root);
  let meta: { name?: string; description?: string; apx_id?: string; kind?: string } = {};
  try {
    meta = JSON.parse(readText(path.join(abs, ".apc", "project.json")) ?? "{}");
  } catch {}
  const pathId = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const id = meta.apx_id && /^[a-z0-9]{6,32}$/.test(meta.apx_id) ? meta.apx_id : pathId;
  const agentsMd = readText(path.join(abs, "AGENTS.md"));
  const apc = path.join(abs, ".apc");
  const memoryMd = isLink(apc) ? undefined : readText(path.join(apc, "memory.md"))?.trim();
  return {
    id,
    pathId,
    root: abs,
    name: meta.name || path.basename(abs),
    description: meta.description,
    kind: meta.kind,
    context: agentsMd ? cap(agentsMd.trim()) : undefined,
    memory: memoryMd ? cap(memoryMd, MEMORY_MD_CAP, ".apc/memory.md") : undefined,
  };
}

export function readAgents(root: string): ApcAgent[] {
  const dir = path.join(path.resolve(root), ".apc", "agents");
  let files: string[] = [];
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return [];
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && SLUG_RE.test(f.slice(0, -3)))
      .sort();
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    const text = readText(path.join(dir, f));
    if (text === undefined) return [];
    const slug = f.slice(0, -3);
    const { fields, body } = parseFrontmatter(text);
    // v1 wrote Title-case keys in some files and lowercase in others.
    const get = (k: string) => fields[k] ?? fields[k.charAt(0).toUpperCase() + k.slice(1)];
    return [
      {
        slug,
        name: textField(get("name")) ?? slug,
        role: textField(get("role")) ?? "",
        description: textField(get("description")),
        prompt: body,
        model: textField(get("model")),
        parent: textField(get("parent")),
        icon: textField(get("icon")),
        emoji: textField(get("emoji")),
        skills: listField(get("skills")),
        tools: listField(get("tools")),
        aliases: listField(get("aliases")),
        fields,
      },
    ];
  });
}
