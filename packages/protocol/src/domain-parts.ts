import { z } from "zod";
import { ApprovalScope, FileChange, InputKind, InputState } from "./domain-approvals.ts";
import { Id } from "./domain-projects.ts";
import { RunEndReason, RunState } from "./domain-threads.ts";
import { schemaFields } from "./schema-fields.ts";

/**
 * Something the owner can connect, offered by an agent for what they asked: an integration (an account like Figma or
 * GitHub, Resources › Integrations) or a channel (an app like WhatsApp, the Channels screen). `coming`: not yet.
 */
export const ConnectOffer = z.object(
  schemaFields({
    kind: () => z.enum(["integration", "channel"]),
    id: () => z.string(),
    label: () => z.string(),
    description: () => z.string(),
    coming: () => z.boolean().optional(),
  }),
);
export type ConnectOffer = z.infer<typeof ConnectOffer>;

/** Where a document's file is in its chat: a path in the chat's folder, or (`scratch`) in its temp folder. */
export const DocumentSource = z.object(
  schemaFields({
    path: () => z.string().max(1000),
    scratch: () => z.boolean().optional(),
  }),
);
export type DocumentSource = z.infer<typeof DocumentSource>;

/** What the UI shows. The model's own transcript is stored separately (two projections of one log). */
const KnownPart = z.discriminatedUnion("type", [
  z.object(
    schemaFields({
      type: () => z.literal("text"),
      text: () => z.string(),
      /** A task consult's reply, kept as words for history readers and as a traced event for operators. */
      response: () =>
        z
          .object(
            schemaFields({
              thread_id: () => Id,
              run_id: () => Id,
              task_id: () => Id,
              title: () => z.string(),
              state: () => RunState,
              end_reason: () => RunEndReason.optional(),
              issue: () => z.enum(["no_answer", "actions_failed"]).optional(),
              /** The steps that failed (their titles), when some of its actions did. */
              failed: () => z.array(z.string().max(200)).max(5).optional(),
              project_id: () => Id.optional(),
            }),
          )
          .optional(),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("tool"),
      call_id: () => z.string(),
      tool: () => z.string(),
      title: () => z.string(),
      status: () => z.enum(["running", "ok", "error"]),
      detail: () => z.string().optional(),
      /** How long it took, once it ended. */
      ms: () => z.number().int().nonnegative().optional(),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("surface"),
      surface_id: () => Id,
      version: () => z.number().int(),
      title: () => z.string(),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("subthread"),
      thread_id: () => Id,
      agent_id: () => Id,
      title: () => z.string(),
      state: () => RunState,
      /** What it answered (the whole report, up to a few thousand characters). */
      summary: () => z.string().optional(),
      /** A worker's name: a throwaway helper the caller started for this task (agent_id is then the caller's own). */
      worker: () => z.string().optional(),
      /** How long it worked, once it ended. */
      ms: () => z.number().int().nonnegative().optional(),
      /** Why it ended, once it did (a completed run that ran out of steps is not a finished one). */
      end_reason: () => RunEndReason.optional(),
      /** Who asked, when it is not the message's author (a consult on a task): an agent's id, or "owner". */
      asked_by: () => z.string().optional(),
      /** A completed run that did not go well: it gave no answer, or some of its actions failed. */
      issue: () => z.enum(["no_answer", "actions_failed"]).optional(),
      /** The steps that failed (their titles), when some of its actions did. */
      failed: () => z.array(z.string().max(200)).max(5).optional(),
      /** Its answer waits for the others asked in the same turn: how many of them are in (DECISIONS.md#d-194). */
      held: () =>
        z
          .object(
            schemaFields({
              got: () => z.number().int().nonnegative(),
              of: () => z.number().int().positive(),
            }),
          )
          .optional(),
    }),
  ),
  z.object(
    schemaFields({
      type: () => z.literal("browser"),
      /** Where the tab is when it is not APX's own browser: the isolated computer, or the owner's Chrome. */
      environment: () => z.enum(["vm", "chrome"]).optional(),
      tab: () => z.string(),
      url: () => z.string(),
      title: () => z.string(),
      state: () => z.enum(["agent", "handoff", "user", "done"]),
      reason: () => z.string().optional(),
    }),
  ),
  /** An image: one from the web (`url`) or one APX made (`media_id`, its bytes from media.get). */
  z.object(
    schemaFields({
      type: () => z.literal("image"),
      url: () => z.string().optional(),
      media_id: () => Id.optional(),
      mime: () => z.string().optional(),
      /** The tool call that generated this picture, scoped to its run, including across split messages. */
      tool_call_id: () => z.string().optional(),
      alt: () => z.string().default(""),
    }),
  ),
  /** Recorded or synthesized speech; the bytes come from media.get. */
  z.object(
    schemaFields({
      type: () => z.literal("audio"),
      media_id: () => Id,
      mime: () => z.string(),
      transcript: () => z.string().optional(),
    }),
  ),
  /** A file from either participant; document snapshots also open in the side panel. */
  z.object(
    schemaFields({
      type: () => z.literal("file"),
      media_id: () => Id,
      name: () => z.string(),
      mime: () => z.string(),
      bytes: () => z.number().int(),
      document: () =>
        z
          .object(
            schemaFields({
              title: () => z.string().max(120),
              format: () => z.enum(["markdown", "text"]),
              /** The file it was read from, for files.reveal and files.open. */
              source: () => DocumentSource.optional(),
            }),
          )
          .optional(),
    }),
  ),
  /**
   * What changed in a code thread's folder (uncommitted, per git) when the turn ended; with `edits`, the files the
   * agent wrote in this turn with its file tools.
   */
  z.object(
    schemaFields({
      type: () => z.literal("changes"),
      cwd: () => z.string(),
      edits: () => z.boolean().optional(),
      /** The files are in the chat's temp folder (`cwd`): the agent's scratch work, not changes to the owner's folders. */
      scratch: () => z.boolean().optional(),
      files: () => z.array(FileChange),
      more: () => z.number().int().optional(),
    }),
  ),
  /** The agent waits for the owner: a yes/no on an action, or an answer to a question. Answered with runs.respond. */
  z.object(
    schemaFields({
      type: () => z.literal("input"),
      input_id: () => Id,
      kind: () => InputKind,
      prompt: () => z.string(),
      /** For a confirmation: the tool and a readable summary of its arguments. */
      tool: () => z.string().optional(),
      detail: () => z.string().optional(),
      artifact_draft: () => z.string().uuid().optional(),
      browser: () =>
        z
          .object(
            schemaFields({
              origin: () => z.string(),
              title: () => z.string().max(200).optional(),
              tab_number: () => z.number().int().positive().optional(),
              document: () => z.string(),
              path: () => z.string().optional(),
              sha256: () => z.string().optional(),
            }),
          )
          .optional(),
      change: () => FileChange.optional(),
      options: () => z.array(z.string()).optional(),
      /** A question whose options may be picked several at once. */
      multi: () => z.boolean().optional(),
      /** A read outside the agent's folders: the folders it would read (approval_scopes says if they may be kept). */
      folders: () => z.array(z.string()).optional(),
      approval_scopes: () => z.array(ApprovalScope).optional(),
      approval_scope: () => ApprovalScope.optional(),
      state: () => InputState,
      answer: () => z.string().optional(),
    }),
  ),
  /**
   * The skills of this turn: given whole (`loaded`: one named with "/name"), named for the agent to load (`strong`
   * when very close, else `hinted`), and the closest ones weighed (`scored`, with their raw similarity), so the chat
   * can show what went in and what nearly did. Turns before strong existed have none.
   */
  z.object(
    schemaFields({
      type: () => z.literal("skills"),
      engine: () => z.string(),
      loaded: () => z.array(z.string()),
      strong: () => z.array(z.string()).optional(),
      hinted: () => z.array(z.string()),
      scored: () =>
        z.array(
          z.object(
            schemaFields({
              name: () => z.string(),
              sim: () => z.number(),
            }),
          ),
        ),
    }),
  ),
  /**
   * A few answers the agent offers (and, `custom`, one the owner writes); picking one replies with it. `for` says which
   * question of getting to know the owner it answers (setup.onboard): their name, their work, how the agent talks
   * (which also sets its personality), what to help with first. None offered: the owner writes it.
   */
  z.object(
    schemaFields({
      type: () => z.literal("choices"),
      for: () => z.enum(["name", "work", "personality", "help"]),
      options: () =>
        z.array(
          z.object(
            schemaFields({
              label: () => z.string(),
              value: () => z.string(),
            }),
          ),
        ),
      custom: () => z.boolean().optional(),
    }),
  ),
  /**
   * What the agent offers the owner to connect for what they asked (suggest_connection): each opens its form where it
   * is shown. `why`: the agent's line on what it would do with it.
   */
  z.object(
    schemaFields({
      type: () => z.literal("connect"),
      why: () => z.string().optional(),
      offers: () => z.array(ConnectOffer),
    }),
  ),
  /** The agent's plan for this chat's work: steps it marks as it goes (in a task's chat, the task's plan too). */
  z.object(
    schemaFields({
      type: () => z.literal("plan"),
      steps: () =>
        z.array(
          z.object(
            schemaFields({
              step: () => z.string(),
              state: () => z.enum(["pending", "doing", "done"]),
            }),
          ),
        ),
    }),
  ),
  /** A Flow an agent made or changed in this turn: the chat shows its drawing and opens it in the editor. */
  z.object(
    schemaFields({
      type: () => z.literal("flow"),
      flow: () => z.string(),
      project: () => z.string(),
      name: () => z.string(),
    }),
  ),
  /** Something the system says about the turn (interrupted, fallback engine, no answer): never the agent's words. */
  z.object(
    schemaFields({
      type: () => z.literal("notice"),
      level: () => z.enum(["info", "warn", "error"]),
      /** Stable code the UI translates (e.g. "run.interrupted"); `text` is the English fallback. */
      code: () => z.string(),
      text: () => z.string(),
      /** Values for the translated text's {placeholders}. */
      vars: () => z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      /** Verbatim output that is never translated (e.g. a routine command's last lines). */
      detail: () => z.string().optional(),
    }),
  ),
]);
const KNOWN_PARTS: ReadonlySet<string> = new Set(KnownPart.options.map((o) => o.shape.type.value));

/**
 * A part this client does not know yet (sent by a newer core) is shown as a notice instead of breaking the whole
 * message: old apps and cached panels keep working while the protocol grows.
 */
export const Part = z.preprocess((v) => {
  const type = (v as { type?: unknown } | null)?.type;
  return typeof type === "string" && !KNOWN_PARTS.has(type)
    ? { type: "notice", level: "info", code: "part.unknown", text: `This part (${type}) needs a newer version of APX.` }
    : v;
}, KnownPart);
export type Part = z.infer<typeof KnownPart>;
