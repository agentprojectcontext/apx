// Cross-agent, cross-conversation session search + locator.
// Walks the on-disk session and conversation files for each project and
// returns matches with a small excerpt window. Used by the HTTP adapter and
// (planned) CLI session find.
import fs from "node:fs";
import path from "node:path";
import { apcAgentsDir } from "../apc/paths.js";

const EXCERPT_CHARS = 300;
const EXCERPT_LINES_BEFORE = 1;
const EXCERPT_LINES_AFTER = 3;

function scanFile(filePath, needle) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!text.toLowerCase().includes(needle)) return null;
    const lines = text.split("\n");
    const matchLine = lines.findIndex((l) => l.toLowerCase().includes(needle));
    const excerpt = lines
      .slice(Math.max(0, matchLine - EXCERPT_LINES_BEFORE), matchLine + EXCERPT_LINES_AFTER)
      .join("\n");
    return excerpt.slice(0, EXCERPT_CHARS);
  } catch {
    return null;
  }
}

/**
 * Search for `needle` across one project's session + conversation files.
 *
 * @param project   { id, path, storagePath } record from ProjectManager
 * @param needle    lowercase query string
 * @param remaining max matches to add (search short-circuits when reached)
 * @returns matches array (may be empty)
 */
export function searchProjectSessions(project, needle, remaining) {
  const matches = [];
  if (!project || remaining <= 0) return matches;

  // 1) Legacy session files in the repo (.apc/agents/<slug>/sessions/)
  const sessionAgentsDir = apcAgentsDir(project.path);
  if (fs.existsSync(sessionAgentsDir)) {
    for (const slug of fs.readdirSync(sessionAgentsDir)) {
      const sessionsDir = path.join(sessionAgentsDir, slug, "sessions");
      if (!fs.existsSync(sessionsDir)) continue;
      for (const f of fs.readdirSync(sessionsDir).filter((x) => x.endsWith(".md"))) {
        const filePath = path.join(sessionsDir, f);
        const excerpt = scanFile(filePath, needle);
        if (excerpt != null) {
          matches.push({
            type: "session",
            project: project.id,
            agent: slug,
            filename: f,
            path: filePath,
            excerpt,
          });
          if (matches.length >= remaining) return matches;
        }
      }
    }
  }

  // 2) Conversation files in daemon storage (~/.apx/projects/<id>/agents/<slug>/conversations/)
  const convAgentsDir = path.join(project.storagePath, "agents");
  if (fs.existsSync(convAgentsDir)) {
    for (const slug of fs.readdirSync(convAgentsDir)) {
      const convDir = path.join(convAgentsDir, slug, "conversations");
      if (!fs.existsSync(convDir)) continue;
      for (const f of fs.readdirSync(convDir).filter((x) => x.endsWith(".md"))) {
        const filePath = path.join(convDir, f);
        const excerpt = scanFile(filePath, needle);
        if (excerpt != null) {
          matches.push({
            type: "conversation",
            project: project.id,
            agent: slug,
            filename: f,
            path: filePath,
            excerpt,
          });
          if (matches.length >= remaining) return matches;
        }
      }
    }
  }

  return matches;
}

/** Run searchProjectSessions across an array of projects, capping at `limit`. */
export function searchSessions(projectList, query, limit) {
  const needle = String(query || "").toLowerCase();
  const matches = [];
  for (const p of projectList) {
    if (!p) continue;
    const remaining = limit - matches.length;
    if (remaining <= 0) break;
    matches.push(...searchProjectSessions(p, needle, remaining));
  }
  return matches.slice(0, limit);
}

/**
 * Find the conversation file (under daemon storage) for a given session id,
 * scanning a list of candidate projects. Returns { project, agentSlug, filename }
 * or null. `id` is taken as bare or with .md suffix.
 */
export function findSessionFile(projectList, id) {
  const filename = id.endsWith(".md") ? id : `${id}.md`;
  for (const p of projectList) {
    if (!p) continue;
    const agentsDir = path.join(p.storagePath, "agents");
    if (!fs.existsSync(agentsDir)) continue;
    for (const slug of fs.readdirSync(agentsDir)) {
      const f = path.join(agentsDir, slug, "conversations", filename);
      if (fs.existsSync(f)) return { project: p, agentSlug: slug, filename };
    }
  }
  return null;
}
