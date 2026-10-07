// A folder as the owner browses it (a project's, or a chat's): one level at a time, and a file's text.
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

/** An uncommitted file in a chat's folder, per git: its status letters and the lines added and removed. */
export const ChangedFile = z.object({
  path: z.string(),
  status: z.string(),
  added: z.number().int().optional(),
  removed: z.number().int().optional(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

/**
 * Whose folder: a project's, or the one a chat works in (a code session's own, its project's, or APX's work folder);
 * with `scratch`, the chat's temp folder instead.
 */
const Where = { project: Id.optional(), thread: Id.optional(), scratch: z.boolean().optional() };

export const filesMethods = {
  /**
   * What is uncommitted in the folder a chat works in (its own, or its project's), per git; `git` false when the
   * folder is not in a repository.
   */
  "files.changes": {
    params: z.object({ thread: Id }).strict(),
    result: z.object({ cwd: z.string(), git: z.boolean(), files: z.array(ChangedFile) }),
    effect: false,
    access: "human",
  },
  /** Working-tree diff against HEAD, or a recorded turn's snapshot when `message` is given. Legacy records return labeled current content. */
  "files.diff": {
    params: z
      .object({
        thread: Id,
        path: z.string().min(1).max(1000),
        message: Id.optional(),
        part: z.number().int().nonnegative().optional(),
      })
      .strict(),
    result: z.object({
      path: z.string(),
      diff: z.string(),
      truncated: z.boolean(),
      source: z.enum(["recorded", "current"]).optional(),
    }),
    effect: false,
    access: "human",
  },
  /**
   * One folder (folders first, by name); `truncated` when it holds more than the list shows. `root` is the browsed
   * folder's own path.
   */
  "files.tree": {
    params: z.object({ ...Where, dir: z.string().max(1000).default("") }).strict(),
    result: z.object({ root: z.string(), entries: z.array(FileEntry), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
  /** A file's text (up to 256 KB); a binary file says so instead. */
  "files.read": {
    params: z.object({ ...Where, path: z.string().min(1).max(1000) }).strict(),
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
    params: z.object({ ...Where, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ mime: z.string(), data: z.string(), bytes: z.number().int() }),
    effect: false,
    access: "human",
  },
  /** Shows the file or folder in Finder (Explorer, the file manager). */
  "files.reveal": {
    params: z.object({ ...Where, path: z.string().max(1000) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Renames a file or folder in place (a new name, never a new folder). */
  "files.rename": {
    params: z
      .object({
        ...Where,
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
  /**
   * Copies a file or folder of a chat's temp folder into the folder the chat works in, at its top, so it stays: the
   * system clears temp folders on its own. A taken name gets a number. Returns where it went.
   */
  "files.keep": {
    params: z.object({ thread: Id, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ path: z.string() }),
    effect: true,
    access: "human",
  },
  /** Moves a file or folder to the system trash (recoverable there); never the project's folder itself. */
  "files.trash": {
    params: z.object({ ...Where, path: z.string().min(1).max(1000) }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
} as const;
