// An artifact built as files: saving <artifact sources>/<name>/index.html (or dist/index.html) with the file tools shows
// it as the artifact <name>, then runs it once and reports what broke. See DECISIONS.md#d-122.
import fs from "node:fs";
import path from "node:path";
import { artifactSources } from "./folders.ts";
import { card, MAX_HTML } from "./surfaces.ts";
import type { ToolContext } from "./types.ts";
import { widgetScriptError } from "./widget-syntax.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** The artifact a written file is the page of, when it sits where artifact pages live in this chat's project. */
export function artifactOfFile(home: string, projectId: string | undefined, file: string): string | undefined {
  const rel = path.relative(artifactSources(home, projectId), file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(path.sep);
  const page =
    (parts.length === 2 && parts[1] === "index.html") ||
    (parts.length === 3 && parts.slice(1).join("/") === "dist/index.html");
  return page && parts[0] && NAME.test(parts[0]) ? parts[0] : undefined;
}

/**
 * Why an artifact built from files cannot also be retyped through show_widget or edit_widget: two copies would drift.
 * Undefined when it has no page in its folder.
 */
export function builtFromFiles(home: string, projectId: string | undefined, name: string): string | undefined {
  const page = path.join(artifactSources(home, projectId), name, "index.html");
  if (!fs.existsSync(page)) return undefined;
  return `refused: "${name}" is built from files; change ${page} with file_edit or file_write (each save shows it and reports how it started). Nothing changed.`;
}

/** Shows the saved page as its artifact and checks it: the lines to add to the write's result. */
export async function publishArtifactFile(ctx: ToolContext, name: string, html: string): Promise<string> {
  if (html.length > MAX_HTML) return `\nNot shown as artifact "${name}": the page passes ${MAX_HTML} characters.`;
  const broken = await widgetScriptError(html, "file_write", ctx.signal);
  if (broken) return `\nNot shown as artifact "${name}": ${broken}`;
  const title = /<title>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.trim() || name;
  let shown: Awaited<ReturnType<typeof ctx.call<"surfaces.show">>>;
  try {
    shown = await ctx.call("surfaces.show", { name, title, html, thread: ctx.thread.id });
  } catch (e) {
    return `\nNot shown as artifact "${name}": ${e instanceof Error ? e.message : String(e)}`;
  }
  card(ctx, shown);
  const head = `\nArtifact "${name}" v${shown.version} shown (${shown.app ? "app" : "widget"}).`;
  const check = await ctx.call("surfaces.check", { html }).catch(() => undefined);
  if (!check?.checked) return `${head} It was not run here (no browser): open it to check it starts.`;
  const seen =
    (check.text ? `\nOn screen after start: ${check.text.slice(0, 400)}` : "") +
    (check.views.length > 1
      ? `\nIts views, opened in turn:\n${check.views.map((v) => `- ${v.view}: ${v.text || "(empty)"}`).join("\n")}`
      : "");
  if (!check.errors.length) return `${head} It started without errors.${seen}`;
  return `${head} It threw while starting; fix these before going on:\n${check.errors.map((e) => `- ${e}`).join("\n")}${seen}`;
}
