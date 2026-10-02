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
/** The largest image, video, audio or PDF the viewer previews; bigger ones are opened from Finder. */
export const FILE_MEDIA_LIMIT = 15 * 1024 * 1024;

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
  /** An image, video, audio or PDF of the project, for the viewer to show (up to 15 MB). */
  "files.media": {
    params: z.object({ project: Id, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int() }),
    effect: false,
    access: "human",
  },
  /** Shows the file or folder in Finder (Explorer, the file manager). */
  "files.reveal": {
    params: z.object({ project: Id, path: z.string().max(1000) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Renames a file or folder in place (a new name, never a new folder). */
  "files.rename": {
    params: z
      .object({
        project: Id,
        path: z.string().min(1).max(1000),
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine((n) => !/[/\\]/.test(n) && n !== "." && n !== "..", "a name, not a path"),
      })
      .strict(),
    result: z.object({ path: z.string() }),
    effect: true,
    access: "human",
  },
  /** Moves a file or folder to the system trash (recoverable there); never the project's folder itself. */
  "files.trash": {
    params: z.object({ project: Id, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
} as const;
