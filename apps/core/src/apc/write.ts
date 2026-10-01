// Writing agent files in a project's .apc/agents/. Only the fields APX changes are rewritten; every other
// frontmatter line and the layout of the file stay as the owner (or another tool) left them. Nothing is deleted:
// removing an agent moves its file to .apc/agents/.archived/.
import fs from "node:fs";
import path from "node:path";
import { SLUG_RE } from "./read.ts";

export type AgentFileFields = {
  name?: string | undefined;
  role?: string | undefined;
  description?: string | undefined;
  parent?: string | undefined;
  icon?: string | undefined;
  aliases?: string[] | undefined;
};

const agentsDir = (root: string) => path.join(root, ".apc", "agents");
export const agentFile = (root: string, slug: string) => path.join(agentsDir(root), `${slug}.md`);

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

function atomicWrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function writeNewAgent(root: string, slug: string, fields: AgentFileFields, prompt: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}" (lowercase letters, digits, - and _)`);
  const file = agentFile(root, slug);
  if (fs.existsSync(file)) throw new Error(`an agent file already exists: .apc/agents/${slug}.md`);
  atomicWrite(
    file,
    join(
      setFields([], {
        name: fields.name,
        role: fields.role,
        description: fields.description,
        parent: fields.parent,
        icon: fields.icon,
      }),
      prompt,
    ),
  );
}

export function updateAgentFile(root: string, slug: string, fields: AgentFileFields, prompt?: string): void {
  const file = agentFile(root, slug);
  const { front, body } = split(fs.readFileSync(file, "utf8"));
  const next = setFields(front, {
    name: fields.name,
    role: fields.role,
    description: fields.description,
    parent: fields.parent,
    icon: fields.icon,
    aliases: fields.aliases,
  });
  atomicWrite(file, join(next, prompt ?? body));
}

/** Renames the file and remembers the old slug in `aliases`, so references written elsewhere still resolve. */
export function renameAgentFile(root: string, from: string, to: string, aliases: string[]): void {
  if (!SLUG_RE.test(to)) throw new Error(`invalid slug "${to}"`);
  if (fs.existsSync(agentFile(root, to))) throw new Error(`an agent file already exists: .apc/agents/${to}.md`);
  updateAgentFile(root, from, { aliases: [...new Set([...aliases, from])] });
  fs.renameSync(agentFile(root, from), agentFile(root, to));
}

/** Moves the file out of the agents folder; nothing is deleted. */
export function archiveAgentFile(root: string, slug: string): string {
  const dest = path.join(agentsDir(root), ".archived", `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(agentFile(root, slug), dest);
  return path.relative(root, dest);
}
