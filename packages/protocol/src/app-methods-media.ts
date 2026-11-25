// Methods behind the app screens.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { Id, Run, SurfaceOrigin, SurfaceState, SurfaceSummary } from "./domain.ts";

export const appMediaMethods = {
  /**
   * A media file a widget shows (an image, video or audio, up to 15 MB), read-only and scoped to the widget's project:
   * `ref` is a path in the project's folder (the base project's for a global widget) or `media:<id>` for a file APX
   * stored in one of that project's chats. Only refs written in the widget's own HTML resolve.
   */
  "surfaces.media": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          ref: z.string().trim().min(1).max(1000),
        })
        .strict(),
    result: () =>
      z.object({
        mime: z.string(),
        data: z.string(),
        bytes: z.number().int(),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Creates or updates a widget by its stable name (per project). Called by an agent, it lands in the agent's thread;
   * `thread` places it elsewhere, and one of the owner's agents may name another `project` (DECISIONS.md#d-271).
   */
  "surfaces.show": deferMethod({
    params: () =>
      z
        .object({
          name: z
            .string()
            .min(1)
            .max(60)
            .regex(/^[a-z0-9][a-z0-9-]*$/),
          title: z.string().min(1).max(120),
          html: z.string().min(1).max(400000),
          pinned: z.boolean().optional(),
          app: z.boolean().optional(),
          page: z.boolean().optional(),
          /** Origins it may read live data from ([] removes them; absent keeps the current ones). */
          connect: z.array(SurfaceOrigin).max(5).optional(),
          thread: Id.optional(),
          /** Without a thread (`apx artifacts push`): the project it belongs to; none makes it global. */
          project: Id.optional(),
        })
        .strict(),
    result: () => SurfaceSummary,
    effect: true,
  }),
  /**
   * Copies a widget into another project (`project_id` null: the base project), as the owner's: same title, page and
   * origins, its name kept unless that project has one by it ("-2" then). Not linked to the original afterwards.
   */
  "surfaces.copy": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          project_id: Id.nullable(),
          pinned: z.boolean().default(false),
        })
        .strict(),
    result: () => SurfaceSummary,
    effect: true,
    access: "human",
  }),
  /**
   * An HTML page in a project's folder (one an imported session wrote) as a widget of that project: its local
   * scripts and styles inlined, its images and videos loaded from the folder (data-apx-src). Again: a new version.
   */
  "surfaces.import_page": deferMethod({
    params: () =>
      z
        .object({
          project_id: Id,
          path: z.string().min(1).max(1000),
          name: z
            .string()
            .min(1)
            .max(60)
            .regex(/^[a-z0-9][a-z0-9-]*$/)
            .optional(),
          title: z.string().trim().min(1).max(120).optional(),
          pinned: z.boolean().default(true),
        })
        .strict(),
    result: () => SurfaceSummary,
    effect: true,
    access: "human",
  }),
  "surfaces.update": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          /** On its project's board; never a web page's. */
          pinned: z.boolean().optional(),
          /** What it is (an app); making one an app also lists it in Apps. */
          app: z.boolean().optional(),
          page: z.boolean().optional(),
          /** Listed in Apps, whatever it is. */
          in_apps: z.boolean().optional(),
        })
        .strict(),
    result: () => SurfaceSummary,
    effect: true,
  }),
  /**
   * Deletes a widget for good, with what it remembers (APX.store, APX.db): the chats that showed it keep their messages.
   * Owner only.
   */
  "surfaces.remove": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
        })
        .strict(),
    result: () =>
      z.object({
        removed: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /** Publishes (or revokes) a surface as an artifact: a standalone page at /a/<token>, isolated from the API. */
  "surfaces.share": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          shared: z.boolean(),
        })
        .strict(),
    result: () => SurfaceSummary,
    effect: true,
    access: "human",
  }),
  /**
   * Changes what a widget remembers (APX.state): `patch` keys are set, a null removes one; `replace` starts from empty.
   * Refused past SURFACE_STATE_MAX characters of JSON. The page and its version stay as they are.
   */
  "surfaces.set_state": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          patch: SurfaceState,
          replace: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        state: SurfaceState,
      }),
    effect: true,
  }),
  /** A widget's sendPrompt(): the text goes to the thread that owns the surface, as the user. */
  "surfaces.prompt": deferMethod({
    params: () =>
      z
        .object({
          surface: Id,
          text: z.string().min(1).max(4000),
        })
        .strict(),
    result: () =>
      z.object({
        thread: Id,
        run: Run,
      }),
    effect: true,
  }),
} as const;
