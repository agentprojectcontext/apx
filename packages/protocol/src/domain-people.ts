import { z } from "zod";
import { PERSON_RELATIONS } from "./constants.ts";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

/**
 * People APX talks to. The owner is one person with addresses on each channel; a contact gets a sealed conversation
 * (no tools, no memory, nothing of the owner's); anyone else is a stranger until the owner approves a pairing code.
 */
export const PersonRole = z.enum(["owner", "contact", "blocked"]);
export type PersonRole = z.infer<typeof PersonRole>;
export const Address = z.object(
  schemaFields({
    id: () => Id,
    person_id: () => Id,
    /** The channel instance ("telegram-main") and the id the platform gives this person there. */
    channel: () => z.string(),
    external_id: () => z.string(),
    label: () => z.string().optional(),
  }),
);
export type Address = z.infer<typeof Address>;
/** How a contact relates to the owner: it shapes how the agent talks to them. */
export const PersonRelation = z.enum(PERSON_RELATIONS);
export type PersonRelation = z.infer<typeof PersonRelation>;
/**
 * What a contact's chat may do besides talking, and whether it is answered past the attention hours. Each tool one gives
 * the sealed turn exactly one narrow tool (see DECISIONS.md#d-022). An account sets them for its contacts
 * (`ChannelInfo.contacts`, all off unless set); a person keeps only the ones the owner set for them, which win.
 */
const RIGHTS = {
  /** Note an appointment they ask for, for the owner to confirm. */
  appointments: z.boolean(),
  /** Note a request they make (a purchase, a favor) as a task for the owner. */
  requests: z.boolean(),
  /** Answer from the owner's own notes (global ones only, read-only). */
  notes: z.boolean(),
  /** Answered at any hour, past the attention hours of the account they write on. */
  any_hour: z.boolean(),
};
/** The rights set somewhere (an account, a person): one not set follows the next place, and in the end is off. */
export const PersonPerms = z.object(RIGHTS).partial();
export type PersonPerms = z.infer<typeof PersonPerms>;
export const ContactRights = z.object(
  schemaFields({
    appointments: () => z.boolean().default(false),
    requests: () => z.boolean().default(false),
    notes: () => z.boolean().default(false),
    any_hour: () => z.boolean().default(false),
  }),
);
export type ContactRights = z.infer<typeof ContactRights>;
/** A person's rights on one account: what the owner set for them, the account's for the rest. */
export const contactRightsOf = (perms: PersonPerms | undefined, account: PersonPerms | undefined): ContactRights =>
  ContactRights.parse({
    ...account,
    ...Object.fromEntries(Object.entries(perms ?? {}).filter(([, v]) => v !== undefined)),
  });
export const Person = z.object(
  schemaFields({
    id: () => Id,
    name: () => z.string(),
    role: () => PersonRole,
    /** "Who they are", in the owner's words: reaches only the turns that answer this person. */
    note: () => z.string().optional(),
    nickname: () => z.string().optional(),
    relation: () => PersonRelation.optional(),
    /** The owner's rules for answering them; they go last in the prompt. */
    rules: () => z.string().optional(),
    /** Silenced: their messages are kept, never answered. */
    muted: () => z.boolean().default(false),
    /** Wrote first and was kept silenced for the owner to decide: each message of theirs is reported meanwhile. */
    unreviewed: () => z.boolean().default(false),
    /**
     * Supervised: their messages get a reply drafted, never sent on its own; the owner sends it, edits it or drops it.
     * Silenced and supervised exclude each other (setting one clears the other).
     */
    supervised: () => z.boolean().default(false),
    /** The rights the owner set for them; the rest follow the account they write on (`ChannelInfo.contacts`). */
    perms: () => PersonPerms.default({}),
    /**
     * The agent that answers this contact on every channel, instead of each account's contacts agent. None: the
     * account's. Never set for the owner.
     */
    agent_id: () => Id.optional(),
    addresses: () => z.array(Address),
    created_at: () => z.string(),
  }),
);
export type Person = z.infer<typeof Person>;

/** What became of a reply drafted for a supervised contact. */
export const SuggestionState = z.enum(["pending", "sent", "discarded", "superseded"]);
export type SuggestionState = z.infer<typeof SuggestionState>;
/** A reply the agent drafted for a supervised contact, waiting for the owner (see channels/suggestions.ts). */
export const ContactSuggestion = z.object(
  schemaFields({
    id: () => Id,
    person_id: () => Id,
    /** The contact's chat, where it goes once sent. */
    thread_id: () => Id,
    channel: () => z.string(),
    /** Their messages it answers, oldest first. */
    said: () => z.array(z.string()),
    /** The reply the agent would send; empty when it wrote none (see `error`). */
    text: () => z.string(),
    /** Why there is no draft: no model answered, or nothing needed an answer. */
    error: () => z.string().optional(),
    model: () => z.string().optional(),
    state: () => SuggestionState,
    created_at: () => z.string(),
    decided_at: () => z.string().optional(),
    /** The chat message it became, once sent. */
    message_id: () => Id.optional(),
  }),
);
export type ContactSuggestion = z.infer<typeof ContactSuggestion>;
