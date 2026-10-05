// show_widget: the agent creates or updates a widget; pinned, it lives on its project's board; it can also be an app.
import { SurfaceOrigin } from "@apx/protocol";
import { z } from "zod";
import { defineTool, type Tool } from "./types.ts";

export function surfaceTools(): Tool[] {
  return [
    defineTool({
      name: "show_widget",
      description:
        "Show a visual widget in the chat: self-contained HTML (inline CSS/JS/SVG). It makes no network requests except to the origins in connect (https:// or wss://, e.g. a public market API) for live data: fetch or WebSocket to them only, the owner sees which. Use the CSS vars --apx-bg, --apx-surface, --apx-fg, --apx-fg-muted, --apx-border, --apx-brand for the theme. The same name updates the existing widget (keep a board current by updating it, never by making a new one). pin=true puts it on this project's board (its overview) and in the sidebar; app=true lists it as a fullscreen app. An artifact (a standalone page to open or share) is a widget the owner publishes with its share button: make it with show_widget, never as an HTML file on disk. window.apx.sendPrompt(text) sends a message back to this chat.",
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
          name:
            a.name
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, "-")
              .replace(/^-+/, "")
              .slice(0, 60) || "widget",
          title: a.title.slice(0, 120) || a.name,
          html: a.html.slice(0, 400_000),
          thread: ctx.thread.id,
          ...(a.pin === undefined ? {} : { pinned: a.pin }),
          ...(a.app === undefined ? {} : { app: a.app }),
          ...(a.connect === undefined ? {} : { connect: a.connect }),
        });
        ctx.upsertPart((p) => p.type === "surface" && p.surface_id === surface.id, {
          type: "surface",
          surface_id: surface.id,
          version: surface.version,
          title: surface.title,
        });
        const where = [
          surface.pinned ? "pinned to the project's board" : "",
          surface.app ? "listed as an app" : "",
          surface.connect ? `connecting to ${surface.connect.join(", ")}` : "",
        ].filter(Boolean);
        return `widget "${surface.name}" v${surface.version} shown${where.length ? `, ${where.join(", ")}` : ""}.`;
      },
    }),
  ];
}
