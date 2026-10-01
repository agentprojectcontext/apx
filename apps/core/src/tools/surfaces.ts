// show_widget: the agent creates or updates a widget; the owner can pin it to the sidebar or open it as an app.
import type { Store } from "../domain/store.ts";
import { obj, str, type Tool } from "./types.ts";

export function surfaceTools(store: Store): Tool[] {
  return [
    {
      name: "show_widget",
      description:
        "Show a visual widget in the chat: self-contained HTML (inline CSS/JS/SVG, no external requests). Use the CSS vars --apx-bg, --apx-surface, --apx-fg, --apx-fg-muted, --apx-border, --apx-brand for the theme. The same name updates the existing widget. pin=true keeps it in the sidebar; app=true lists it as a fullscreen app. window.apx.sendPrompt(text) sends a message back to this chat.",
      parameters: obj(
        {
          name: str("stable kebab-case name, e.g. monthly-sales"),
          title: str("human title"),
          html: str("full HTML body"),
          pin: { type: "boolean" },
          app: { type: "boolean" },
        },
        ["name", "title", "html"],
      ),
      effect: "local",
      deadlineMs: 10_000,
      title: (a) => `Made the widget ${String(a.title ?? a.name)}`,
      async run(a, ctx) {
        const surface = store.surfaces.upsert({
          name: String(a.name)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .slice(0, 60),
          title: String(a.title).slice(0, 120),
          html: String(a.html).slice(0, 400_000),
          project_id: ctx.thread.project_id,
          thread_id: ctx.thread.id,
          created_by: ctx.agent.id,
          pinned: a.pin === undefined ? undefined : Boolean(a.pin),
          app: a.app === undefined ? undefined : Boolean(a.app),
        });
        ctx.upsertPart((p) => p.type === "surface" && p.surface_id === surface.id, {
          type: "surface",
          surface_id: surface.id,
          version: surface.version,
          title: surface.title,
        });
        const where = [surface.pinned ? "pinned to the sidebar" : "", surface.app ? "listed as an app" : ""].filter(
          Boolean,
        );
        return `widget "${surface.name}" v${surface.version} shown${where.length ? `, ${where.join(", ")}` : ""}.`;
      },
    },
  ];
}
