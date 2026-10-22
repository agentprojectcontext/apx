import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { readsOutside } from "./folders.ts";
import { defineTool } from "./types.ts";

export const DOCUMENT_GUIDANCE =
  "- Documents: write the file first (.md for readable ones); open_document only for a long report, plan or reference, or when asked. Small edits, code and configuration get a short summary, never a document or a widget.";

export function documentTool(store: Store, home: string) {
  return defineTool({
    name: "open_document",
    description:
      "Show a .md, .markdown or .txt file you can read in the chat's side panel (rendered, source and download), as a snapshot of it now (400 KB at most); .txt renders as Markdown too. For a long report, plan or reference, or when the owner asks; not after every edit. Do not repeat the whole document in your answer. Never say it opened unless this succeeds: if it fails, give the path.",
    args: z.object({
      path: z.string().trim().min(1).max(1000),
      title: z.string().trim().min(1).max(120).optional(),
      format: z.enum(["markdown", "text"]).default("markdown"),
    }),
    effect: "local",
    outside: (a, ctx) => readsOutside(store, home, ctx.thread, [String(a.path)]),
    deadlineMs: 15_000,
    title: (a) =>
      `Opened document ${
        a.title ??
        String(a.path ?? "")
          .split(/[\\/]/)
          .at(-1)
      }`,
    async run(a, ctx) {
      const { media: m, source } = await ctx.call("media.attach", { path: a.path, document: true });
      ctx.upsertPart((p) => p.type === "file" && p.media_id === m.id, {
        type: "file",
        media_id: m.id,
        mime: m.mime,
        name: m.name,
        bytes: m.bytes,
        document: { title: a.title ?? m.name.slice(0, 120), format: a.format, ...(source && { source }) },
      });
      return `Document ${m.name} (${m.bytes} bytes) opened as ${a.format} in this chat's side panel; a saved snapshot, not an app.`;
    },
  });
}
