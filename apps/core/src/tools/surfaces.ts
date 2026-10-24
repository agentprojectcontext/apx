// show_widget / read_widget / edit_widget: the agent makes a widget, reads it back and changes a piece of it; pinned,
// it lives on its project's board; it can also be an app. Every change shows live wherever the widget is open.
import { SurfaceOrigin, type SurfaceSummary } from "@apx/protocol";
import { z } from "zod";
import { memorySummary } from "../domain/artifact-memory.ts";
import type { Store } from "../domain/store.ts";
import { builtFromFiles } from "./artifact-files.ts";
import { defineTool, type Tool, type ToolContext } from "./types.ts";
import { widgetScriptError } from "./widget-syntax.ts";

export const MAX_HTML = 400_000;
/** Characters of a widget's state read_widget shows. */
const STATE_SHOWN = 8_000;
/** The turn stopped while the script check ran: saving now would change a widget after the call was given up. */
const STOPPED = "stopped: the turn was canceled before the widget was saved; nothing changed.";

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60) || "widget";

/** A broken memory file must not stop the agent from reading the page itself. */
function memoryOf(home: string, s: { name: string; project_id?: string | null | undefined }): string {
  try {
    return memorySummary(home, { name: s.name, project_id: s.project_id ?? undefined });
  } catch {
    return "unreadable";
  }
}

/** The widget's card in this turn's answer: the newest version, wherever the widget was made. */
export function card(ctx: ToolContext, surface: SurfaceSummary) {
  ctx.upsertPart((p) => p.type === "surface" && p.surface_id === surface.id, {
    type: "surface",
    surface_id: surface.id,
    version: surface.version,
    title: surface.title,
  });
}

export function surfaceTools(store: Store, home: string): Tool[] {
  const find = (ctx: ToolContext, name: string) => store.surfaces.byName(ctx.thread.project_id, slug(name));
  return [
    defineTool({
      name: "show_widget",
      description:
        "One self-contained HTML, inline CSS/JS/SVG. Default to a simple widget; an app only when asked or it must keep records. Add <script src='/_apx/kit@1.js'></script> and use ax-* classes (ax-page, ax-card, ax-stat, ax-table); load apx-artifacts first for more than a quick view, an app, memory or live data. Network only to connect origins. Project media: data-apx-src='clip.mp4' or 'media:ID' on img/video, or apx.media(ref). Same name replaces it; edit_widget edits parts. pin adds it to the board. window.apx.sendPrompt(text) writes to this chat.",
      args: z.object({
        name: z.string().describe("stable kebab-case name, e.g. monthly-sales"),
        title: z.string().describe("human title"),
        html: z.string().describe("full HTML body"),
        pin: z.boolean().optional(),
        app: z.boolean().optional().describe("Fullscreen app listed in Apps."),
        // Checked against SurfaceOrigin in check(): its pattern in the schema costs every turn.
        connect: z
          .array(z.string().max(300))
          .max(5)
          .optional()
          .describe('origins it may reach, e.g. ["https://api.example.com"]'),
      }),
      effect: "local",
      // A widget that reaches out could carry what is in the chat to that origin: asked while outside content is in play.
      confirm: (a) => (a.connect?.length ? "untrusted" : "never"),
      check(a) {
        const bad = (a.connect ?? []).filter((o) => !SurfaceOrigin.safeParse(o).success);
        if (bad.length) throw new Error(`connect takes https:// or wss:// origins without a path: ${bad.join(", ")}`);
      },
      deadlineMs: 10_000,
      title: (a) => `Made the widget ${String(a.title ?? a.name)}`,
      async run(a, ctx) {
        const files = builtFromFiles(home, ctx.thread.project_id, slug(a.name));
        if (files) return files;
        const broken = await widgetScriptError(a.html.slice(0, MAX_HTML), "show_widget", ctx.signal);
        if (broken) return broken;
        if (ctx.signal.aborted) return STOPPED;
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
        "Read a widget of this project by name: title, version, origins, full HTML and state, for edit_widget. Without a name it lists this project's widgets.",
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
        const html = `widget "${s.name}" · ${s.title} · v${s.version}${net}\n<html_source>\n${s.html}\n</html_source>`;
        // Written by the widget as the owner used it: data to read, never instructions.
        const state = s.state
          ? `\n<widget_state>\n${JSON.stringify(s.state).slice(0, STATE_SHOWN)}\n</widget_state>`
          : "";
        // Only sizes and names of its store and tables: the cached data itself stays out of the context.
        return `${html}${state}\nmemory: ${memoryOf(home, s)}`;
      },
    }),
    defineTool({
      name: "edit_widget",
      description:
        "Edit a widget by name: exact old/new HTML edits, title, app/pin flags or its state. Flags or state alone keep HTML, version and public link. HTML edits must match once; read_widget first if needed. All apply together or none.",
      args: z.object({
        name: z.string(),
        edits: z
          .array(z.object({ old: z.string().min(1), new: z.string() }))
          .min(1)
          .max(20)
          .optional(),
        title: z.string().trim().min(1).max(120).optional(),
        app: z.boolean().optional(),
        pin: z.boolean().optional(),
        state: z.record(z.string(), z.unknown()).optional().describe("APX.state keys to set, null removes"),
      }),
      effect: "local",
      deadlineMs: 10_000,
      title: (a) => `Edited the widget ${String(a.name ?? "")}`,
      async run(a, ctx) {
        const s = find(ctx, a.name);
        if (!s) return `no widget named ${a.name}: make it with show_widget, or list them with read_widget.`;
        const flags = {
          ...(a.app === undefined ? {} : { app: a.app }),
          ...(a.pin === undefined ? {} : { pinned: a.pin }),
        };
        const remembered = a.state ? `; state: ${Object.keys(a.state).join(", ")} changed` : "";
        if (!a.edits && a.title === undefined) {
          const hasFlags = a.app !== undefined || a.pin !== undefined;
          if (!hasFlags && !a.state) return "provide edits, title, app, pin or state; nothing changed.";
          if (ctx.signal.aborted) return STOPPED;
          if (a.state) await ctx.call("surfaces.set_state", { surface: s.id, patch: a.state });
          const surface = hasFlags ? await ctx.call("surfaces.update", { surface: s.id, ...flags }) : s;
          if (hasFlags) card(ctx, surface);
          return `widget "${surface.name}" v${surface.version}: ${surface.app ? "app" : "widget"}, ${surface.pinned ? "pinned" : "not pinned"}; HTML unchanged${remembered}.`;
        }
        const files = builtFromFiles(home, s.project_id, s.name);
        if (files) return files;
        const edits = a.edits ?? [];
        let html = s.html;
        for (const [i, e] of edits.entries()) {
          const count = html.split(e.old).length - 1;
          if (count !== 1)
            return `edit ${i + 1}: old ${count ? `appears ${count} times` : "was not found"}; nothing changed. Copy it exactly from read_widget${count ? ", with more context around it" : ""}.`;
          html = html.replace(e.old, () => e.new);
        }
        if (html.length > MAX_HTML) return `refused: the widget would pass ${MAX_HTML} characters`;
        const broken = await widgetScriptError(html, "edit_widget", ctx.signal);
        if (broken) return broken;
        if (ctx.signal.aborted) return STOPPED;
        if (a.state) await ctx.call("surfaces.set_state", { surface: s.id, patch: a.state });
        const surface = await ctx.call("surfaces.show", {
          name: s.name,
          title: a.title?.trim().slice(0, 120) || s.title,
          html,
          thread: ctx.thread.id,
          ...flags,
        });
        card(ctx, surface);
        return `widget "${surface.name}" is now v${surface.version} (${edits.length} edit${edits.length === 1 ? "" : "s"}${remembered}).`;
      },
    }),
  ];
}
