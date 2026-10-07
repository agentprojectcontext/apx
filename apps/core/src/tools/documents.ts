import { z } from "zod";
import { defineTool } from "./types.ts";

export const DOCUMENT_GUIDANCE =
  "- Documents: write or edit the file first, then use open_document only when showing it helps the owner: a long report, plan, reusable reference, or an explicit request to open it. Prefer .md and Markdown headings, lists and tables for readable documents; .txt can also render as Markdown without renaming it. Small edits, code, configuration files and ordinary tool output usually need only a short summary: file_write, file_edit, apply_patch or a shell edit never require opening a document. Do not turn documents into widgets/apps or duplicate the full document in your answer. If open_document is unavailable, report the file path without claiming it opened.";

export function documentTool() {
  return defineTool({
    name: "open_document",
    description:
      "Open an existing .md, .markdown or .txt file as a document in the owner's chat side panel. Use after writing a long report, plan or reusable reference, or when the owner asks to open a document; do not call after every edit or for code/configuration. Markdown is the default even for .txt (no renaming); text shows it verbatim. The panel offers rendered view, source and download. This takes a snapshot of a UTF-8 text file inside your work folder, at most 400000 bytes. The snapshot survives source edits/deletion and chat reload. Opening again shows a new snapshot. Never claim it opened unless this tool succeeds.",
    args: z.object({
      path: z.string().trim().min(1).max(1000),
      title: z.string().trim().min(1).max(120).optional(),
      format: z.enum(["markdown", "text"]).default("markdown"),
    }),
    effect: "local",
    deadlineMs: 15_000,
    title: (a) =>
      `Opened document ${
        a.title ??
        String(a.path ?? "")
          .split(/[\\/]/)
          .at(-1)
      }`,
    async run(a, ctx) {
      const { media: m } = await ctx.call("media.attach", { path: a.path, document: true });
      ctx.upsertPart((p) => p.type === "file" && p.media_id === m.id, {
        type: "file",
        media_id: m.id,
        mime: m.mime,
        name: m.name,
        bytes: m.bytes,
        document: { title: a.title ?? m.name.slice(0, 120), format: a.format },
      });
      return `Document ${m.name} (${m.bytes} bytes) opened as ${a.format} in this chat's side panel; a saved snapshot, not an app.`;
    },
  });
}
