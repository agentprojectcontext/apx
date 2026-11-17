import { z } from "zod";
import type { Google } from "./google.ts";
import { GoogleAccessError } from "./google-errors.ts";

export const SpreadsheetId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const Cell = z.union([z.string().max(2000), z.number(), z.boolean()]);
const Values = z.array(z.array(Cell).min(1).max(50)).min(1).max(200);

function dimensions(range: string) {
  const match = /!([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/.exec(range);
  if (!match) return { rows: 0, columns: 0 };
  const column = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return {
    rows: Number(match[4] ?? match[2]) - Number(match[2]) + 1,
    columns: column(match[3] ?? match[1] ?? "") - column(match[1] ?? "") + 1,
  };
}

/** Require an explicit tab and rectangle: bare columns, named ranges and open-ended reads are ambiguous or unbounded. */
const SheetRange = z
  .string()
  .max(260)
  .regex(/^(?:'(?:[^']|''){1,200}'|[A-Za-z_][A-Za-z0-9_ ]{0,99})![A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/)
  .refine((range) => {
    const { rows, columns } = dimensions(range);
    return rows > 0 && columns > 0 && rows <= 200 && columns <= 50 && rows * columns <= 2000;
  }, "Use an explicit tab and rectangle of at most 200 rows, 50 columns and 2,000 cells");

export const SheetRead = z.object({ id: SpreadsheetId, range: SheetRange }).strict();
export const SheetWrite = SheetRead.extend({ values: Values })
  .strict()
  .refine((o) => {
    const { rows, columns } = dimensions(o.range);
    return (
      o.values.length <= rows &&
      o.values.every((row) => row.length <= columns) &&
      JSON.stringify(o.values).length <= 20_000
    );
  }, "Values must fit the requested rectangle and 20,000 characters");
export const SheetCreate = z
  .object({
    title: z.string().trim().min(1).max(200),
    tab: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^[\]*?:/\\]+$/)
      .default("Sheet1"),
  })
  .strict();

const Tab = z.object({
  sheetId: z.number().int(),
  title: z.string(),
  gridProperties: z.object({ rowCount: z.number().int(), columnCount: z.number().int() }).optional(),
});
const Metadata = z.object({
  spreadsheetId: SpreadsheetId,
  properties: z.object({ title: z.string() }),
  sheets: z.array(z.object({ properties: Tab })).max(200),
});
const ValueResponse = z.object({ range: z.string(), values: z.array(z.array(Cell).max(50)).max(200).optional() });

export function sheetsApi(g: Google) {
  const root = `${g.endpoints.sheets}/spreadsheets`;
  const fields = "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))";
  const link = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
  async function call<T>(url: string, options: Parameters<Google["call"]>[2], signal?: AbortSignal): Promise<T> {
    try {
      signal?.throwIfAborted();
      return await g.call<T>("google-drive", url, {
        ...options,
        maxResponseBytes: 256 * 1024,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("Google Sheets request cancelled");
      if (error instanceof GoogleAccessError) throw new GoogleAccessError(error.code, "Google Drive");
      throw new Error(
        "Google Sheets could not complete the request. Check file access, the Sheets API and your Google sign-in before trying again.",
      );
    }
  }
  return {
    async tabs(id: string, signal?: AbortSignal) {
      SpreadsheetId.parse(id);
      const result = Metadata.parse(
        await call(`${root}/${encodeURIComponent(id)}`, { query: { fields, includeGridData: false } }, signal),
      );
      return {
        id: result.spreadsheetId,
        title: result.properties.title,
        link: link(result.spreadsheetId),
        tabs: result.sheets.map((s) => ({
          id: s.properties.sheetId,
          title: s.properties.title,
          ...(s.properties.gridProperties
            ? { rows: s.properties.gridProperties.rowCount, columns: s.properties.gridProperties.columnCount }
            : {}),
        })),
      };
    },
    async read(input: z.input<typeof SheetRead>, signal?: AbortSignal) {
      const o = SheetRead.parse(input);
      const result = ValueResponse.parse(
        await call(
          `${root}/${encodeURIComponent(o.id)}/values/${encodeURIComponent(o.range)}`,
          { query: { majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" } },
          signal,
        ),
      );
      const values = result.values ?? [];
      const { rows, columns } = dimensions(o.range);
      if (values.length > rows || values.some((row) => row.length > columns) || JSON.stringify(values).length > 20_000)
        throw new Error("Sheet content exceeds the requested bounds; choose a smaller range");
      return { id: o.id, range: result.range, values };
    },
    async create(input: z.input<typeof SheetCreate>, signal?: AbortSignal) {
      const o = SheetCreate.parse(input);
      const result = Metadata.parse(
        await call(
          root,
          {
            method: "POST",
            query: { fields },
            body: { properties: { title: o.title }, sheets: [{ properties: { title: o.tab } }] },
          },
          signal,
        ),
      );
      return { id: result.spreadsheetId, title: result.properties.title, link: link(result.spreadsheetId) };
    },
    async write(input: z.input<typeof SheetWrite>, signal?: AbortSignal) {
      const o = SheetWrite.parse(input);
      const result = z
        .object({
          updatedRange: z.string(),
          updatedRows: z.number().int().optional(),
          updatedColumns: z.number().int().optional(),
          updatedCells: z.number().int().optional(),
        })
        .parse(
          await call(
            `${root}/${encodeURIComponent(o.id)}/values/${encodeURIComponent(o.range)}`,
            {
              method: "PUT",
              query: { valueInputOption: "RAW", includeValuesInResponse: false },
              body: { range: o.range, majorDimension: "ROWS", values: o.values },
            },
            signal,
          ),
        );
      return { id: o.id, range: result.updatedRange, cells: result.updatedCells ?? 0, link: link(o.id) };
    },
  };
}
