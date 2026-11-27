import { z } from "zod";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/**
 * Repeated approvals belong to the owner; a session lasts in one chat until the core restarts. `always` with an
 * `agent_id` is that agent's; without one, every agent's. `project` answers a folder card: the folder becomes a
 * read-only folder of the chat's project (never a grant).
 */
export const ApprovalScope = z.enum(["once", "session", "always", "project", "tab", "turn"]);
export type ApprovalScope = z.infer<typeof ApprovalScope>;
/** Ends the key of a grant for a tool's calls that always ask (a destructive command, a routine change). */
export const STRICT_APPROVAL = "#always";
export const ToolApproval = z.object(
  schemaFields({
    key: () => z.string(),
    server: () => z.string(),
    project_id: () => Id.optional(),
    tool: () => z.string(),
    scope: () => z.enum(["session", "always", "tab", "turn"]),
    browser: () =>
      z
        .object(
          schemaFields({
            origin: () => z.string(),
            tab: () => z.string(),
            epoch: () => z.string(),
            run: () => Id,
            title: () => z.string().max(200).optional(),
            tab_number: () => z.number().int().positive().optional(),
          }),
        )
        .optional(),
    thread_id: () => Id.optional(),
    agent_id: () => Id.optional(),
    /**
     * Only calls whose arguments match: comma-separated paths, domains or names ("app/Http/", "github.com"). A call
     * matches when one of its text arguments starts with one, or is a URL on that domain.
     */
    condition: () => z.string().max(200).optional(),
    /** After this it asks again. */
    expires_at: () => z.string().optional(),
    granted_at: () => z.string().optional(),
    /** The chat it was granted from. */
    from_thread: () => Id.optional(),
    /** Given by APX's open default (a new MCP server), not by the owner: outside content in the turn still asks. */
    by_default: () => z.literal(true).optional(),
  }),
);
export type ToolApproval = z.infer<typeof ToolApproval>;

/** A file a turn changed, or a confirmation proposes to change: a unified patch (from the first hunk) when known. */
export const FileChange = z.object(
  schemaFields({
    path: () => z.string(),
    status: () => z.string(),
    added: () => z.number().int().optional(),
    removed: () => z.number().int().optional(),
    diff: () => z.string().max(64_000).optional(),
    truncated: () => z.boolean().optional(),
  }),
);
export type FileChange = z.infer<typeof FileChange>;

export const InputKind = z.enum(["confirm", "question"]);
export type InputKind = z.infer<typeof InputKind>;
/**
 * `expired` = nobody answered in time or the run ended first; for a confirmation it counts as a no. `withdrawn` = the
 * agent took its question back before the owner answered.
 */
export const InputState = z.enum(["pending", "approved", "denied", "answered", "expired", "withdrawn"]);
export type InputState = z.infer<typeof InputState>;

/** Something an agent waits on from the owner. Durable: it outlives a restart of the core. */
export const PendingInput = z.object(
  schemaFields({
    id: () => Id,
    run_id: () => Id,
    thread_id: () => Id,
    agent_id: () => Id,
    kind: () => InputKind,
    prompt: () => z.string(),
    tool: () => z.string().optional(),
    detail: () => z.string().optional(),
    artifact_draft: () => z.string().uuid().optional(),
    /** For a confirmation of a file write: what the file would become, as a patch. */
    change: () => FileChange.optional(),
    options: () => z.array(z.string()).optional(),
    multi: () => z.boolean().optional(),
    /** A read outside the agent's folders: the folders it would read, which the owner may let it read. */
    folders: () => z.array(z.string()).optional(),
    approval_scopes: () => z.array(ApprovalScope).optional(),
    approval_scope: () => ApprovalScope.optional(),
    state: () => InputState,
    answer: () => z.string().optional(),
    created_at: () => z.string(),
    expires_at: () => z.string(),
    answered_at: () => z.string().optional(),
  }),
);
export type PendingInput = z.infer<typeof PendingInput>;
