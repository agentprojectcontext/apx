// A project's folder as the owner browses it: one folder level at a time, and a file's text. Read-only.
import { z } from "zod";
import { Id } from "./domain.ts";

export const FileEntry = z.object({
  name: z.string(),
  /** Relative to the project's folder, with "/" separators. */
  path: z.string(),
  kind: z.enum(["dir", "file"]),
  bytes: z.number().int().optional(),
});
export type FileEntry = z.infer<typeof FileEntry>;

/** What the viewer shows at most of one file. */
export const FILE_READ_LIMIT = 256 * 1024;

export const filesMethods = {
  /** One folder of the project (folders first, by name); `truncated` when it holds more than the list shows. */
  "files.tree": {
    params: z.object({ project: Id, dir: z.string().max(1000).default("") }).strict(),
    result: z.object({ entries: z.array(FileEntry), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
  /** A file's text (up to 256 KB); a binary file says so instead. */
  "files.read": {
    params: z.object({ project: Id, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({
      path: z.string(),
      bytes: z.number().int(),
      binary: z.boolean(),
      truncated: z.boolean(),
      text: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
} as const;
