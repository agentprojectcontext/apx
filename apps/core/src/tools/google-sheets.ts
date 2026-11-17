import { z } from "zod";
import type { Google } from "../integrations/google.ts";
import { SheetCreate, SheetRead, SheetWrite, SpreadsheetId, sheetsApi } from "../integrations/sheets.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export function sheetsTools(g: Google): Tool[] {
  const api = sheetsApi(g);
  const when = (thread: { project_id?: string | undefined }) => g.usable("google-drive", thread.project_id);
  return [
    defineTool({
      name: "sheets_tabs",
      description:
        "List the tabs of a Google spreadsheet by id from drive_search. Uses the connected Drive account; APX sign-in reaches only app-accessible files.",
      args: z.object({ id: SpreadsheetId }).strict(),
      effect: "none",
      deadlineMs: 30_000,
      when,
      title: () => "Read spreadsheet tabs",
      async run(args, ctx) {
        return untrusted("spreadsheet", { id: args.id }, JSON.stringify(await api.tabs(args.id, ctx.signal)));
      },
    }),
    defineTool({
      name: "sheets_read",
      description:
        "Read displayed cell values from an explicit tab and bounded A1 rectangle, such as 'Budget 2026'!A1:D20. Up to 200 rows, 50 columns and 2,000 cells; chunk larger reads. No formulas or formatting edits.",
      args: SheetRead,
      effect: "none",
      deadlineMs: 30_000,
      when,
      title: () => "Read spreadsheet cells",
      async run(args, ctx) {
        return untrusted(
          "spreadsheet",
          { id: args.id, range: args.range },
          JSON.stringify(await api.read(args, ctx.signal)),
        );
      },
    }),
    defineTool({
      name: "sheets_create",
      description:
        "Create an empty Google spreadsheet with a title and initial tab using the connected Drive account. Returns its id and link; use sheets_write for cell values. Does not share it.",
      args: SheetCreate,
      effect: "external",
      confirm: "ask",
      deadlineMs: 30_000,
      when,
      title: () => "Created a spreadsheet",
      async run(args, ctx) {
        return JSON.stringify(await api.create(args, ctx.signal));
      },
    }),
    defineTool({
      name: "sheets_write",
      description:
        "Replace values within an explicit tab and A1 rectangle after owner confirmation. Only app-accessible files can be written. Values are literal RAW data, never evaluated formulas. Empty strings clear cells; omitted cells are unchanged. No append, formatting or sharing.",
      args: SheetWrite,
      effect: "external",
      confirm: "always",
      deadlineMs: 30_000,
      when,
      title: () => "Changed spreadsheet cells",
      async run(args, ctx) {
        return JSON.stringify(await api.write(args, ctx.signal));
      },
    }),
  ];
}
