// Reading an APC project from disk: AGENTS.md + .apc/ (project.json, agents/<slug>.md). The files are the source of
// truth for definitions; the core keeps an index in its database. Read-only: nothing here writes the repo.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AGENTS_MD_LIMIT } from "@apx/protocol";
import { type Fields, listField, parseFrontmatter, textField } from "./frontmatter.ts";

export const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

export type ApcProject = {
  /** Stable id: the committed apx_id when there is one, else derived from the path. */
  id: string;
  /** Derived from the folder's path: used when another folder already holds the same apx_id (clone, worktree). */
  pathId: string;
  root: string;
  name: string;
  description?: string | undefined;
  kind?: string | undefined;
  /** AGENTS.md, whole up to the safety limit. */
  context?: string | undefined;
  /** AGENTS.md's full length when it is past the safety limit, so its agents do not get all of it. */
  contextChars?: number | undefined;
  /** .apc/memory.md (written by the owner), capped. */
  memory?: string | undefined;
  /** Why .apc/project.json is there but unreadable: its name, kind and apx_id are then unknown, not absent. */
  metaError?: string | undefined;
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

/** Windows editors and PowerShell 5 may start a UTF-8 file with a BOM; it is not part of the text. */
export const withoutBom = (text: string): string => text.replace(/^\uFEFF/, "");

/**
 * Reads a project file, refusing symlinks: a repo must not be able to pull any other file of the machine into an
 * agent's prompt.
 */
export const readText = (file: string): string | undefined => {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return undefined;
    return withoutBom(fs.readFileSync(file, "utf8"));
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

/**
 * The head (70%) and tail of a file past `max` characters, cut at line ends. The marker names the omitted lines and
 * the file, so an agent can read them with file_read instead of acting without them.
 */
export function cap(text: string, file: string, max = AGENTS_MD_LIMIT): string {
  if (text.length <= max) return text;
  const headMax = Math.floor(max * 0.7);
  // A line end a little before the budget beats a cut mid-sentence; one long line is cut where it is.
  const atLine = (end: number, floor: number) => {
    const nl = text.lastIndexOf("\n", end - 1);
    return nl >= floor ? nl + 1 : end;
  };
  const head = atLine(headMax, headMax * 0.8);
  const tailMin = text.length - (max - headMax);
  const nl = text.indexOf("\n", tailMin);
  const tail = nl >= 0 && nl < tailMin + (max - headMax) * 0.2 ? nl + 1 : tailMin;
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  const from = lineOf(head);
  const to = lineOf(Math.max(head, tail - 1));
  const limit = Math.min(to - from + 1, 2000);
  return `${text.slice(0, head)}\n[… lines ${from}-${to} of ${file} (${tail - head} of its ${text.length} characters) are not shown here: read them with file_read offset=${from} limit=${limit} before acting on anything they may cover …]\n\n${text.slice(tail)}`;
}

/**
 * A project file for its agents' context, whole: how long it is, is the project's choice. Only one past the safety
 * limit is cut, with a marker that says so (DECISIONS.md#d-110).
 */
function contextOf(text: string | undefined, file: string, max = AGENTS_MD_LIMIT): string | undefined {
  const body = text?.trimEnd();
  if (!body?.trim()) return undefined;
  return body.length > max ? cap(body, file, max) : body.trim();
}

/** Whether a folder is an APC project (has .apc/ or AGENTS.md). */
export function isApcProject(root: string): boolean {
  return fs.existsSync(path.join(root, ".apc")) || fs.existsSync(path.join(root, "AGENTS.md"));
}

export function readProject(root: string): ApcProject {
  const abs = path.resolve(root);
  let meta: { name?: string; description?: string; apx_id?: string; kind?: string } = {};
  let metaError: string | undefined;
  const metaText = readText(path.join(abs, ".apc", "project.json"));
  if (metaText !== undefined) {
    try {
      const raw = JSON.parse(metaText) as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) meta = raw as typeof meta;
      else metaError = "not a JSON object";
    } catch (err) {
      metaError = err instanceof Error ? err.message : String(err);
    }
  }
  const pathId = createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const id = meta.apx_id && /^[a-z0-9]{6,32}$/.test(meta.apx_id) ? meta.apx_id : pathId;
  const agentsMd = readText(path.join(abs, "AGENTS.md"));
  const apc = path.join(abs, ".apc");
  const memoryMd = isLink(apc) ? undefined : readText(path.join(apc, "memory.md"));
  return {
    id,
    pathId,
    root: abs,
    name: meta.name || path.basename(abs),
    description: meta.description,
    kind: meta.kind,
    context: contextOf(agentsMd, path.join(abs, "AGENTS.md")),
    contextChars: agentsMd && agentsMd.trimEnd().length > AGENTS_MD_LIMIT ? agentsMd.trimEnd().length : undefined,
    memory: contextOf(memoryMd, path.join(apc, "memory.md")),
    metaError,
  };
}

export function readAgents(root: string): ApcAgent[] {
  return readAgentDir(path.join(path.resolve(root), ".apc", "agents"));
}

/** Every `<slug>.md` agent file directly inside a folder (no symlinks). Also reads template folders. */
export function readAgentDir(dir: string): ApcAgent[] {
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
