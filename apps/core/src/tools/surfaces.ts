// show_widget / read_widget / edit_widget: the agent makes a widget, reads it back and changes a piece of it; pinned,
// it lives on its project's board; it can also be an app. Every change shows live wherever the widget is open.
import { SurfaceOrigin, type SurfaceSummary } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";

const MAX_HTML = 400_000;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60) || "widget";

/** The widget's card in this turn's answer: the newest version, wherever the widget was made. */
function card(ctx: ToolContext, surface: SurfaceSummary) {
  ctx.upsertPart((p) => p.type === "surface" && p.surface_id === surface.id, {
    type: "surface",
    surface_id: surface.id,
    version: surface.version,
    title: surface.title,
  });
}

export function surfaceTools(store: Store): Tool[] {
  const find = (ctx: ToolContext, name: string) => store.surfaces.byName(ctx.thread.project_id, slug(name));
  return [
    defineTool({
      name: "show_widget",
      description:
        "Show a widget in the chat: self-contained HTML (inline CSS/JS/SVG), themed with the CSS vars --apx-bg, --apx-surface, --apx-fg, --apx-fg-muted, --apx-border, --apx-brand. It reaches no network except the origins in connect (https or wss), for live data. Update a widget by showing its name again (the owner sees the new version wherever it is open) or in part with edit_widget; never a second widget for the same thing. pin puts it on the project's board, app lists it as a fullscreen app. A page to share (an artifact) is a widget too, never an HTML file on disk. window.apx.sendPrompt(text) writes to this chat.",
      args: z.object({
        name: z.string().describe("stable kebab-case name, e.g. monthly-sales"),
        title: z.string().describe("human title"),
        html: z.string().describe("full HTML body"),
        pin: z.boolean().optional(),
        app: z.boolean().optional(),
        connect: z
          .array(SurfaceOrigin)
          .max(5)
          .optional()
          .describe('origins it may reach for live data, e.g. ["https://api.example.com", "wss://stream.example.com"]'),
      }),
      effect: "local",
      // A widget that reaches out could carry what is in the chat to that origin: asked while outside content is in play.
      confirm: (a) => (a.connect?.length ? "untrusted" : "never"),
      deadlineMs: 10_000,
      title: (a) => `Made the widget ${String(a.title ?? a.name)}`,
      async run(a, ctx) {
        const surface = await ctx.call("surfaces.show", {
          name: slug(a.name),
          title: a.title.slice(0, 120) || a.name,
          html: a.html.slice(0, MAX_HTML),
          thread: ctx.thread.id,
          // Where the widget lives is the owner's choice once made: an agent adds a place, never takes one away.
          ...(a.pin ? { pinned: true } : {}),
          ...(a.app ? { app: true } : {}),
          ...(a.connect === undefined ? {} : { connect: a.connect }),
        });
        card(ctx, surface);
        const where = [
          surface.project_id ? "" : "in no project (a chat outside a project makes a global widget)",
          surface.pinned ? "pinned to the project's board" : "",
          surface.app ? "listed as an app" : "",
          surface.connect ? `connecting to ${surface.connect.join(", ")}` : "",
        ].filter(Boolean);
        return `widget "${surface.name}" v${surface.version} shown${where.length ? `, ${where.join(", ")}` : ""}.`;
      },
    }),
    defineTool({
      name: "read_widget",
      description:
        "Read a widget of this project by its name: its title, version, the origins it connects to and its full HTML, to change it with edit_widget. Without a name it lists this project's widgets (outside a project, the global ones).",
      args: z.object({ name: z.string().optional() }),
      effect: "none",
      deadlineMs: 10_000,
      title: (a) => (a.name ? `Read the widget ${String(a.name)}` : "Listed the widgets"),
      async run(a, ctx) {
        if (!a.name) {
          const list = store.surfaces.list({ project: ctx.thread.project_id });
          if (!list.length)
            return `no widgets ${ctx.thread.project_id ? "in this project" : "outside a project"} yet: make one with show_widget.`;
          return list
            .slice(0, 40)
            .map((s) => `- ${s.name}: ${s.title} (v${s.version}${s.pinned ? ", pinned" : ""}${s.app ? ", app" : ""})`)
            .join("\n");
        }
        const s = find(ctx, a.name);
        if (!s) return `no widget named ${a.name}: read_widget without a name lists them.`;
        const net = s.connect ? `, connects to ${s.connect.join(", ")}` : "";
        return `widget "${s.name}" · ${s.title} · v${s.version}${net}\n<html_source>\n${s.html}\n</html_source>`;
      },
    }),
    defineTool({
      name: "edit_widget",
      description:
        "Change part of an existing widget without rewriting it: each edit replaces `old` (it must appear exactly once in the widget's HTML, spaces included) with `new`; all edits apply together or none does. The owner sees the new version at once wherever the widget is open. Read it first with read_widget when you do not have its HTML at hand.",
      args: z.object({
        name: z.string(),
        edits: z
          .array(z.object({ old: z.string().min(1), new: z.string() }))
          .min(1)
          .max(20),
        title: z.string().optional().describe("a new title, if it changes"),
      }),
      effect: "local",
      deadlineMs: 10_000,
      title: (a) => `Edited the widget ${String(a.name ?? "")}`,
      async run(a, ctx) {
        const s = find(ctx, a.name);
        if (!s) return `no widget named ${a.name}: make it with show_widget, or list them with read_widget.`;
        let html = s.html;
        for (const [i, e] of a.edits.entries()) {
          const count = html.split(e.old).length - 1;
          if (count !== 1)
            return `edit ${i + 1}: old ${count ? `appears ${count} times` : "was not found"}; nothing changed. Copy it exactly from read_widget${count ? ", with more context around it" : ""}.`;
          html = html.replace(e.old, () => e.new);
        }
        if (html.length > MAX_HTML) return `refused: the widget would pass ${MAX_HTML} characters`;
        const surface = await ctx.call("surfaces.show", {
          name: s.name,
          title: a.title?.trim().slice(0, 120) || s.title,
          html,
          thread: ctx.thread.id,
        });
        card(ctx, surface);
        return `widget "${surface.name}" is now v${surface.version} (${a.edits.length} edit${a.edits.length === 1 ? "" : "s"}).`;
      },
    }),
  ];
}
