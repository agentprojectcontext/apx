import { z } from "zod";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/** A model API our own loop calls (Gemini, OpenCode Zen, Groq, a local Ollama…). The key never leaves the core. */
export const ProviderTransport = z.enum(["openai-chat", "anthropic-messages", "chatgpt-responses"]);
export type ProviderTransport = z.infer<typeof ProviderTransport>;

/** The ChatGPT plan's sign-in for APX's own loop. */
export const ChatgptStatus = z.object(
  schemaFields({
    connected: () => z.boolean(),
    account: () => z.string().optional(),
    /** A sign-in in progress: the code the owner types at the address. */
    pending: () =>
      z
        .object(
          schemaFields({
            user_code: () => z.string(),
            verification_url: () => z.string(),
            expires_at: () => z.string(),
          }),
        )
        .optional(),
    error: () => z.string().optional(),
    /** APX v1 has a ChatGPT sign-in of its own that can be taken over. */
    v1_available: () => z.boolean(),
  }),
);
export type ChatgptStatus = z.infer<typeof ChatgptStatus>;

export const ProviderInfo = z.object(
  schemaFields({
    /** Only a masked key suffix, never a credential. */
    key_hint: () => z.string().max(4).optional(),
    id: () => z.string(),
    label: () => z.string(),
    /** The kind of service, for its card's look (gemini, groq, ollama, openrouter…). */
    preset: () => z.string().optional(),
    transport: () => ProviderTransport,
    base_url: () => z.string(),
    /** Whether a key is stored (or none is needed); for a signed-in plan, whether it is signed in. */
    key_set: () => z.boolean(),
    /** Signed in rather than keyed: the sign-in it uses ("chatgpt"). */
    sign_in: () => z.string().optional(),
    needs_key: () => z.boolean(),
    /** A fixed model list, for servers that cannot list their own; empty = asked to the provider. */
    models: () => z.array(z.string()),
    enabled: () => z.boolean(),
    builtin: () => z.boolean(),
    /** A model app on this computer: found running with no setup, or set up at its address. */
    local: () => z.boolean().optional(),
  }),
);
export type ProviderInfo = z.infer<typeof ProviderInfo>;

/**
 * A note agents keep between threads. `global`: about the owner, every agent sees it; `project`: agents working in
 * that project; `agent`: only that agent. `source` says who wrote it: the owner's notes are not an agent's to remove.
 */
export const MemoryScope = z.enum(["global", "project", "agent"]);
export type MemoryScope = z.infer<typeof MemoryScope>;
export const MemoryEvidence = z.object(
  schemaFields({
    message_id: () => Id,
    quote: () => z.string().min(3).max(2000),
    /** Derived by the core from the owner's confirmation or a read after a write. */
    verification: () =>
      z
        .object(
          schemaFields({
            kind: () => z.enum(["owner_confirmation", "observed_result"]),
            criterion: () => z.string().min(3).max(300),
            step_ids: () => z.array(z.string().min(1).max(200)).max(8).optional(),
          }),
        )
        .optional(),
  }),
);
export type MemoryEvidence = z.infer<typeof MemoryEvidence>;
export const Memory = z.object(
  schemaFields({
    id: () => Id,
    scope: () => MemoryScope,
    project_id: () => Id.optional(),
    agent_id: () => Id.optional(),
    text: () => z.string(),
    revision: () => z.number().int().positive().optional(),
    /** `procedure`: how the agent did something that worked, kept as history (never as an instruction). */
    kind: () => z.enum(["user", "feedback", "project", "reference", "procedure"]).optional(),
    evidence: () => z.array(MemoryEvidence).optional(),
    /** `imported`: brought over from APX v1, neither the owner's word nor checked by an agent since. */
    source: () => z.enum(["owner", "agent", "imported"]),
    /** The agent that wrote it, and the thread and run it learned it in. */
    author_agent: () => Id.optional(),
    thread_id: () => Id.optional(),
    run_id: () => Id.optional(),
    /** A note an agent wrote about the owner (global): it waits for the owner to confirm it before it stands. */
    pending: () => z.boolean(),
    /** Forgotten by the owner or an agent: kept out of every turn until the owner brings it back. */
    forgotten_at: () => z.string().optional(),
    /** Saved by an agent while outside content was in its turn: agents see it as data, not as the owner's word. */
    tainted: () => z.boolean(),
    created_at: () => z.string(),
    updated_at: () => z.string(),
  }),
);
export type Memory = z.infer<typeof Memory>;
