// Writing agent files in a project's .apc/agents/. Only the fields APX changes are rewritten; every other
// frontmatter line and the layout of the file stay as the owner (or another tool) left them. Nothing is deleted:
// removing an agent moves its file to .apc/agents/.archived/.
import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "../paths.ts";
import { listField, parseFrontmatter } from "./frontmatter.ts";
import { SLUG_RE } from "./read.ts";

export type AgentFileFields = {
  name?: string | undefined;
  role?: string | undefined;
  description?: string | undefined;
  parent?: string | undefined;
  icon?: string | undefined;
  area?: string | undefined;
  personality?: string | undefined;
  autonomy?: string | undefined;
  /** "true", or "" to remove it. */
  orchestrator?: string | undefined;
  /** `risk=policy` pairs ("write=ask"). */
  rules?: string[] | undefined;
  tools?: string[] | undefined;
  skills?: string[] | undefined;
  aliases?: string[] | undefined;
};

const agentsDir = (root: string) => path.join(root, ".apc", "agents");
export const agentFile = (root: string, slug: string) => path.join(agentsDir(root), `${slug}.md`);

const isLink = (p: string) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Refuses to write through a symlink: a repo must not be able to redirect APX's writes outside .apc/agents. */
function guard(root: string, ...files: string[]): void {
  for (const p of [path.join(root, ".apc"), agentsDir(root), ...files])
    if (isLink(p)) throw new Error(`refusing to write through a symlink: ${path.relative(root, p)}`);
}

function formatValue(key: string, value: string | string[]): string {
  if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
  if (value.includes("\n"))
    return `${key}: |\n${value
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}`;
  // Quote what YAML-ish readers would otherwise misread.
  return /^[\s"'|>[\]{}#&*!%@`-]|:\s|\s#|\s$/.test(value) ? `${key}: ${JSON.stringify(value)}` : `${key}: ${value}`;
}

/**
 * Replaces (or adds, or removes when undefined is given explicitly as "") the given keys in the frontmatter
 * text, leaving every other line untouched. Matches keys in either case ("role" / "Role").
 */
function setFields(front: string[], fields: Record<string, string | string[] | undefined>): string[] {
  const out = [...front];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const re = new RegExp(`^${key}\\s*:`, "i");
    const at = out.findIndex((l) => re.test(l));
    // The old entry may continue on indented lines (block scalar, list).
    let end = at;
    while (at >= 0 && end + 1 < out.length && /^[ \t]/.test(out[end + 1] ?? "")) end++;
    const empty = Array.isArray(value) ? value.length === 0 : value === "";
    const lines = empty ? [] : formatValue(at >= 0 ? (out[at]?.split(":")[0] ?? key).trim() : key, value).split("\n");
    if (at >= 0) out.splice(at, end - at + 1, ...lines);
    else out.push(...lines);
  }
  return out;
}

function split(text: string): { front: string[]; body: string } {
  const src = text.replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return { front: [], body: src.trim() };
  const end = src.indexOf("\n---", 4);
  if (end < 0) return { front: [], body: src.trim() };
  return { front: src.slice(4, end).split("\n"), body: src.slice(src.indexOf("\n", end + 1) + 1).trim() };
}

const join = (front: string[], body: string) => `---\n${front.join("\n")}\n---\n\n${body.trim()}\n`;

export function writeNewAgent(root: string, slug: string, fields: AgentFileFields, prompt: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}" (lowercase letters, digits, - and _)`);
  const file = agentFile(root, slug);
  guard(root, file);
  if (fs.existsSync(file)) throw new Error(`an agent file already exists: .apc/agents/${slug}.md`);
  writeAtomic(
    file,
    join(
      setFields([], {
        name: fields.name,
        role: fields.role,
        description: fields.description,
        parent: fields.parent,
        icon: fields.icon,
        area: fields.area,
        personality: fields.personality,
        orchestrator: fields.orchestrator,
      }),
      prompt,
    ),
  );
}

/**
 * A new agent file from a template's text, with `parent` set (or removed with "") and, when given, its own `name`
 * and `role`. The rest of the template's frontmatter (area, tools, skills…) and its body are kept as written.
 */
export function writeAgentFromTemplate(
  root: string,
  slug: string,
  text: string,
  fields: { parent: string; name?: string; role?: string },
): void {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}" (lowercase letters, digits, - and _)`);
  const file = agentFile(root, slug);
  guard(root, file);
  if (fs.existsSync(file)) throw new Error(`an agent file already exists: .apc/agents/${slug}.md`);
  const { front, body } = split(text);
  writeAtomic(file, join(setFields(front, fields), body));
}

export function updateAgentFile(root: string, slug: string, fields: AgentFileFields, prompt?: string): void {
  const file = agentFile(root, slug);
  guard(root, file);
  const { front, body } = split(fs.readFileSync(file, "utf8"));
  const next = setFields(front, {
    name: fields.name,
    role: fields.role,
    description: fields.description,
    parent: fields.parent,
    icon: fields.icon,
    area: fields.area,
    personality: fields.personality,
    autonomy: fields.autonomy,
    orchestrator: fields.orchestrator,
    rules: fields.rules,
    tools: fields.tools,
    skills: fields.skills,
    aliases: fields.aliases,
  });
  writeAtomic(file, join(next, prompt ?? body));
}

/** Renames the file and adds the old slug to its `aliases`, so references written elsewhere still resolve. */
export function renameAgentFile(root: string, from: string, to: string): void {
  if (!SLUG_RE.test(to)) throw new Error(`invalid slug "${to}"`);
  guard(root, agentFile(root, from), agentFile(root, to));
  if (fs.existsSync(agentFile(root, to))) throw new Error(`an agent file already exists: .apc/agents/${to}.md`);
  const known = listField(parseFrontmatter(fs.readFileSync(agentFile(root, from), "utf8")).fields.aliases);
  updateAgentFile(root, from, { aliases: [...new Set([...known, from])] });
  fs.renameSync(agentFile(root, from), agentFile(root, to));
}

/** Moves the file out of the agents folder; nothing is deleted. */
export function archiveAgentFile(root: string, slug: string): string {
  guard(root, agentFile(root, slug));
  const dest = path.join(agentsDir(root), ".archived", `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(agentFile(root, slug), dest);
  return path.relative(root, dest);
}

/** The archived copies of an agent's file, newest first (archiveAgentFile names them `<slug>-<time>.md`). */
function archivedFiles(root: string, slug: string): string[] {
  const dir = path.join(agentsDir(root), ".archived");
  const mine = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z\\.md$`);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => mine.test(f))
      .sort()
      .reverse()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Brings an archived agent's newest file back to .apc/agents/; refuses when that slug is taken again. */
export function restoreAgentFile(root: string, slug: string): string {
  const from = archivedFiles(root, slug)[0];
  if (!from) throw new Error(`no archived file for ${slug}`);
  const to = agentFile(root, slug);
  guard(root, to);
  if (fs.existsSync(to)) throw new Error(`.apc/agents/${slug}.md exists: another agent took that slug`);
  fs.renameSync(from, to);
  return path.relative(root, to);
}

/** Deletes every archived copy of an agent's file. */
export function deleteArchivedAgentFiles(root: string, slug: string): number {
  const files = archivedFiles(root, slug);
  for (const f of files) {
    guard(root, f);
    fs.rmSync(f);
  }
  return files.length;
}

export type ProjectMeta = { name?: string | undefined; description?: string | null; kind?: string | null };

/**
 * Changes .apc/project.json: given keys are set ("" or null removes one), every other key (apx_id, what other tools
 * keep there) stays. Refuses a symlinked .apc or file, like the agent files.
 */
export function writeProjectMeta(root: string, meta: ProjectMeta): void {
  const dir = path.join(root, ".apc");
  const file = path.join(dir, "project.json");
  for (const p of [dir, file])
    if (isLink(p)) throw new Error(`refusing to write through a symlink: ${path.relative(root, p)}`);
  let current: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(".apc/project.json is not an object");
    current = raw as Record<string, unknown>;
  }
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (value === null || value === "") delete current[key];
    else current[key] = value;
  }
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`);
}
