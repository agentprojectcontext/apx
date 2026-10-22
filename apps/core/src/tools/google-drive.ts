// Google Drive as APX tools (see tools/google.ts): files come back as outside data, since other people write them.
// Writing a Doc of APX's own needs no OK; sharing one speaks to other people and asks.
import { z } from "zod";
import { driveApi, KINDS, type Kind } from "../integrations/drive.ts";
import type { Google } from "../integrations/google.ts";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const FileId = z.string().min(1).max(200);
const Emails = z.array(z.email()).max(50);
const lines = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

export function driveTools(g: Google): Tool[] {
  const drive = driveApi(g);
  const onDrive = (t: { project_id?: string | undefined }) => g.usable("google-drive", t.project_id);
  return [
    defineTool({
      name: "drive_search",
      description:
        "Find files in the owner's Google Drive by words in their name or text (without q: the most recently changed). With APX's own sign-in it sees only the files APX wrote.",
      args: z.object({
        q: z.string().max(200).optional(),
        kind: z.enum(Object.keys(KINDS) as [Kind, ...Kind[]]).optional(),
        max: z.number().int().min(1).max(50).default(10),
      }),
      effect: "none",
      deadlineMs: 30_000,
      when: onDrive,
      title: (a) => (a.q ? `Searched Drive for ${a.q}` : "Looked at recent files in Drive"),
      async run(a) {
        const found = await drive.search(a);
        if (!found.length) return "no files";
        return untrusted("files", a.q ? { q: a.q } : {}, lines(found));
      },
    }),
    defineTool({
      name: "drive_read",
      description:
        "Read a Google Drive file as text by id (from drive_search): a Doc, a Sheet (CSV), Slides or a text file.",
      args: z.object({ id: FileId }),
      effect: "none",
      deadlineMs: 60_000,
      when: onDrive,
      title: () => "Read a file from Drive",
      async run(a) {
        const r = await drive.read(a.id);
        return untrusted("file", { id: r.file.id, name: r.file.name, type: r.file.type }, r.text);
      },
    }),
    defineTool({
      name: "drive_write_doc",
      description:
        "Write a Google Doc in the owner's Drive from plain text: a new one, or with id one APX wrote before (its whole text is replaced). Returns its link.",
      args: z.object({
        id: FileId.optional(),
        title: z.string().max(200).optional().describe("required for a new Doc"),
        content: z.string().max(200_000),
        folder: FileId.optional().describe("a folder id, for a new Doc"),
      }),
      effect: "external",
      deadlineMs: 60_000,
      when: onDrive,
      title: (a) => (a.title ? `Wrote the Doc ${a.title}` : "Wrote a Doc"),
      async run(a) {
        if (!a.id && !a.title) throw new Error("a new Doc needs a title");
        return JSON.stringify(await drive.writeDoc(a));
      },
    }),
    defineTool({
      name: "drive_share",
      description:
        "Share a file APX wrote in the owner's Drive (from drive_write_doc) with people by email; Google emails them the link.",
      args: z.object({
        id: FileId,
        emails: Emails.min(1),
        role: z.enum(["reader", "commenter", "writer"]).default("reader"),
        message: z.string().max(1000).optional(),
      }),
      effect: "external",
      confirm: "ask",
      deadlineMs: 60_000,
      when: onDrive,
      title: () => "Shared a file from Drive",
      async run(a) {
        return JSON.stringify(await drive.share(a));
      },
    }),
  ];
}
