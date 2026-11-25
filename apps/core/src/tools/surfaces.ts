// show_widget / read_widget / edit_widget: the agent makes a widget, reads it back and changes a piece of it; pinned,
// it lives on its project's board; it can also be an app. Every change shows live wherever the widget is open.
import { SurfaceOrigin, type SurfaceSummary } from "@apx/protocol";
import { z } from "zod";
import { memorySummary } from "../domain/artifact-memory.ts";
import { placeName, worksForOwner } from "../domain/owner-work.ts";
import { inheritsFrom } from "../domain/projects.ts";
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

/** Where a widget call works: this chat's project, or another of the owner's it named; `in` says it in a result. */
type Place = { project: string | undefined; in: string };

const PROJECT_ARG = z
  .string()
  .max(120)
  .optional()
  .describe("another of the owner's projects (id or name, home for none); default this chat's");

export function surfaceTools(store: Store, home: string): Tool[] {
  const find = (at: Place, name: string) => store.surfaces.byName(at.project, slug(name));
  /** A subproject's parent's apps, to read (a change makes the subproject a copy of its own with show_widget). */
  const inherited = (at: Place) => {
    const from = inheritsFrom(store.projects, at.project);
    return from ? store.surfaces.apps(from.project) : [];
  };
  /**
   * The project a call names, reached only from a chat that works for the owner and never into or out of a project
   * being migrated (DECISIONS.md#d-271). A string: why not.
   */
  const placeOf = (ctx: ToolContext, ref: string | undefined): Place | string => {
    const here = ctx.thread.project_id ?? undefined;
    const q = ref?.trim();
    if (!q) return { project: here, in: "" };
    const all = store.projects.list();
    const found = /^home$/i.test(q)
      ? null
      : (all.find((p) => p.id === q) ?? all.find((p) => p.name.toLowerCase() === q.toLowerCase()));
    // Checked before naming any project: a chat for someone else learns none of the owner's.
    const named = found === undefined ? q : (found?.id ?? undefined);
    if (named !== here && !worksForOwner(store, ctx.thread)) return "this chat reaches only its own project's widgets.";
    if (found === undefined)
      return `no project "${q}". Projects: ${all
        .slice(0, 30)
        .map((p) => p.name)
        .join(", ")}`;
    const project = found?.id;
    if (project === here) return { project: here, in: "" };
    if (store.projectProtection.list().some((p) => p.project === here || p.project === project))
      return "refused: a project being migrated keeps its widgets to itself until the migration ends.";
    return { project, in: ` in ${placeName(store, project)}` };
  };
  /**
   * Where a change to a widget lands: its own chat when that chat is in its project, else the project itself. None for
   * a new widget in Home from a project's chat: the call would land in this chat's project instead.
   */
  const target = (ctx: ToolContext, at: Place, threadId: string | undefined) => {
    if (!at.in) return { thread: ctx.thread.id };
    const own = threadId ? store.threads.get(threadId) : undefined;
    if (own && (own.project_id ?? undefined) === at.project) return { thread: own.id };
    return at.project ? { project: at.project } : undefined;
  };
  const NO_HOME = "a new widget in Home is made from a chat outside any project: name a project, or make it here.";
  return [
    defineTool({
      name: "show_widget",
      description:
        'One self-contained HTML, inline CSS/JS/SVG. Default to a simple widget; an app only when asked or it must keep records. Add <script src=\'/_apx/kit@1.js\'></script> and use ax-* classes (ax-page, ax-card, ax-stat, ax-table). Charts are the kit\'s, never drawn by hand: <ax-chart type="line|area|bar" labels="Jan,Feb" data=\'[{"name":"Sales","values":[10,20]}]\'>, <ax-donut label="900" sub="total" data=\'[{"label":"Rent","value":500}]\'> a pie with legend, <ax-split data=\'[…same…]\'> a stacked bar with legend, <ax-bars total="13" data=\'[…]\'> a ranking. Color only by tone (brand, info, violet, warning, danger, neutral), never hex. Load apx-artifacts first for more than a quick view, an app, memory or live data. Network only to connect origins. Project media: data-apx-src=\'clip.mp4\' or \'media:ID\' on img/video, or apx.media(ref). Same name replaces it; edit_widget edits parts. pin adds it to the board; page when asked for a web page. window.apx.sendPrompt(text) writes to this chat.',
      args: z.object({
        name: z.string().describe("stable kebab-case name, e.g. monthly-sales"),
        title: z.string().describe("human title"),
        html: z.string().describe("full HTML body"),
        pin: z.boolean().optional(),
        app: z.boolean().optional().describe("Fullscreen app listed in Apps."),
        page: z.boolean().optional().describe("A web page in its own styles, no kit."),
        // Checked against SurfaceOrigin in check(): its pattern in the schema costs every turn.
        connect: z
          .array(z.string().max(300))
          .max(5)
          .optional()
          .describe('origins it may reach, e.g. ["https://api.example.com"]'),
        project: PROJECT_ARG,
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
        const at = placeOf(ctx, a.project);
        if (typeof at === "string") return at;
        const files = builtFromFiles(home, at.project, slug(a.name));
        if (files) return files;
        const broken = await widgetScriptError(a.html.slice(0, MAX_HTML), "show_widget", ctx.signal);
        if (broken) return broken;
        if (ctx.signal.aborted) return STOPPED;
        const to = target(ctx, at, find(at, a.name)?.thread_id);
        if (!to) return NO_HOME;
        const surface = await ctx.call("surfaces.show", {
          name: slug(a.name),
          title: a.title.slice(0, 120) || a.name,
          html: a.html.slice(0, MAX_HTML),
          ...to,
          // Where the widget lives is the owner's choice once made: an agent adds a place, never takes one away.
          ...(a.pin ? { pinned: true } : {}),
          ...(a.app ? { app: true } : {}),
          ...(a.page ? { page: true } : {}),
          ...(a.connect === undefined ? {} : { connect: a.connect }),
        });
        card(ctx, surface);
        const where = [
          surface.project_id || at.in ? "" : "in no project (a chat outside a project makes a global widget)",
          surface.pinned ? "pinned to the project's board" : "",
          a.pin && surface.page ? "not pinned: a web page is never on a board" : "",
          surface.app ? "an app" : "",
          surface.in_apps ? "listed in Apps" : "",
          surface.page ? "shown as a web page" : "",
          surface.connect ? `connecting to ${surface.connect.join(", ")}` : "",
        ].filter(Boolean);
        return `widget "${surface.name}" v${surface.version} shown${at.in}${where.length ? `, ${where.join(", ")}` : ""}.`;
      },
    }),
    defineTool({
      name: "read_widget",
      description:
        "Read a widget of this project by name: title, version, origins, full HTML and state, for edit_widget. Without a name it lists this project's widgets.",
      args: z.object({ name: z.string().optional(), project: PROJECT_ARG }),
      effect: "none",
      deadlineMs: 10_000,
      title: (a) => (a.name ? `Read the widget ${String(a.name)}` : "Listed the widgets"),
      async run(a, ctx) {
        const at = placeOf(ctx, a.project);
        if (typeof at === "string") return at;
        if (!a.name) {
          const own = store.surfaces.list({ project: at.project });
          const taken = new Set(own.map((s) => s.name));
          const list = [...own, ...inherited(at).filter((s) => !taken.has(s.name))];
          if (!list.length)
            return `no widgets ${at.in ? at.in.trim() : at.project ? "in this project" : "outside a project"} yet: make one with show_widget.`;
          const head = at.in ? `Widgets${at.in}:\n` : "";
          return `${head}${list
            .slice(0, 40)
            .map(
              (s) =>
                `- ${s.name}: ${s.title} (v${s.version}${s.app ? ", app" : s.page ? ", web page" : ""}${s.pinned ? ", pinned" : ""}${s.in_apps ? ", in Apps" : ""}${(s.project_id ?? undefined) === at.project ? "" : ", the parent project's"})`,
            )
            .join("\n")}`;
        }
        const wanted = slug(a.name);
        const parents = inherited(at).find((x) => x.name === wanted);
        const s = find(at, a.name) ?? (parents && store.surfaces.get(parents.id));
        if (!s) return `no widget named ${a.name}${at.in}: read_widget without a name lists them.`;
        const net = s.connect ? `, connects to ${s.connect.join(", ")}` : "";
        const html = `widget "${s.name}"${at.in} · ${s.title} · v${s.version}${net}\n<html_source>\n${s.html}\n</html_source>`;
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
        "Edit a widget by name: exact old/new HTML edits, title, app/pin/page flags or its state. Flags or state alone keep HTML, version and public link. HTML edits must match once; read_widget first if needed. All apply together or none.",
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
        page: z.boolean().optional(),
        state: z.record(z.string(), z.unknown()).optional().describe("APX.state keys to set, null removes"),
        project: PROJECT_ARG,
      }),
      effect: "local",
      deadlineMs: 10_000,
      title: (a) => `Edited the widget ${String(a.name ?? "")}`,
      async run(a, ctx) {
        const at = placeOf(ctx, a.project);
        if (typeof at === "string") return at;
        const s = find(at, a.name);
        if (!s) return `no widget named ${a.name}${at.in}: make it with show_widget, or list them with read_widget.`;
        if (a.pin && (a.page ?? s.page)) return "a web page is a document, not a board tile: it cannot be pinned.";
        const flags = {
          ...(a.app === undefined ? {} : { app: a.app }),
          ...(a.pin === undefined ? {} : { pinned: a.pin }),
          ...(a.page === undefined ? {} : { page: a.page }),
        };
        const remembered = a.state ? `; state: ${Object.keys(a.state).join(", ")} changed` : "";
        if (!a.edits && a.title === undefined) {
          const hasFlags = a.app !== undefined || a.pin !== undefined || a.page !== undefined;
          if (!hasFlags && !a.state) return "provide edits, title, app, pin, page or state; nothing changed.";
          if (ctx.signal.aborted) return STOPPED;
          if (a.state) await ctx.call("surfaces.set_state", { surface: s.id, patch: a.state });
          const surface = hasFlags ? await ctx.call("surfaces.update", { surface: s.id, ...flags }) : s;
          if (hasFlags) card(ctx, surface);
          return `widget "${surface.name}"${at.in} v${surface.version}: ${surface.app ? "app" : surface.page ? "web page" : "widget"}, ${surface.pinned ? "pinned" : "not pinned"}${surface.in_apps ? ", in Apps" : ""}; HTML unchanged${remembered}.`;
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
        const to = target(ctx, at, s.thread_id);
        if (!to) return NO_HOME;
        if (a.state) await ctx.call("surfaces.set_state", { surface: s.id, patch: a.state });
        const surface = await ctx.call("surfaces.show", {
          name: s.name,
          title: a.title?.trim().slice(0, 120) || s.title,
          html,
          ...to,
          ...flags,
        });
        card(ctx, surface);
        return `widget "${surface.name}"${at.in} is now v${surface.version} (${edits.length} edit${edits.length === 1 ? "" : "s"}${remembered}).`;
      },
    }),
  ];
}
