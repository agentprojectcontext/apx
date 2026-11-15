// Methods behind the app screens.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import {
  Author,
  Id,
  PairingRequest,
  Person,
  PersonRelation,
  Run,
  RunContext,
  Surface,
  SurfaceSummary,
  Thread,
} from "./domain.ts";

export const appConnectionsMethods = {
  /** Removes a person (never the owner) with their addresses, or only one address. */
  "contacts.remove": deferMethod({
    params: () => z.object({ id: Id.optional(), address: Id.optional() }).strict(),
    result: () => z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  }),
  /**
   * "This account is mine": an address approved as a contact's becomes the owner's (their chats on that channel
   * too); a contact left with no address is removed.
   */
  /**
   * Links an address the owner types (a phone number on WhatsApp, a chat id on Telegram) to a person, the owner by
   * default: whoever writes from it is that person from then on.
   */
  "contacts.address": deferMethod({
    params: () =>
      z
        .object({
          channel: z.string().min(1).max(32),
          address: z.string().trim().min(3).max(80),
          person: Id.optional(),
        })
        .strict(),
    result: () => Person,
    effect: true,
    access: "human",
  }),
  /** A person's profile picture on their channel (WhatsApp, Telegram), as media to fetch; none when hidden. */
  "contacts.avatar": deferMethod({
    params: () => z.object({ person: Id }).strict(),
    result: () => z.object({ media_id: Id.optional() }),
    effect: false,
    access: "human",
  }),
  /**
   * A mailbox account stops reading someone: their address (or their whole domain) goes on its "Never read" list and
   * the person is blocked, their card and chat kept. `undo` reads them again: the entry leaves the list, the block too.
   */
  "contacts.never_read": deferMethod({
    params: () =>
      z
        .object({ person: Id, channel: Id, scope: z.enum(["address", "domain"]), undo: z.boolean().optional() })
        .strict(),
    result: () => z.object({ blocked: z.string() }),
    effect: true,
    access: "human",
  }),
  "contacts.claim": deferMethod({
    params: () => z.object({ address: Id }).strict(),
    result: () => z.object({ moved: z.boolean() }),
    effect: true,
    access: "human",
  }),
  /**
   * "This is not me": one of the owner's addresses becomes a contact the owner has not reviewed (kept silenced, never
   * answered until approved), with its chats on that channel. Named as they last signed there, else by the address.
   */
  "contacts.unclaim": deferMethod({
    params: () => z.object({ address: Id }).strict(),
    result: () => Person,
    effect: true,
    access: "human",
  }),
  /**
   * Everyone who wrote on a channel account, in its rooms or in private, newest first: their address there, the name
   * they last wrote under, when, where and how often. `person_id` when the address is someone's on file. Only people:
   * the platforms' bots never reach APX.
   */
  "contacts.seen": deferMethod({
    params: () => z.object({ channel: z.string().min(1).max(32) }).strict(),
    result: () =>
      z.object({
        seen: z.array(
          z.object({
            address: z.string(),
            name: z.string(),
            last_at: z.string(),
            thread_id: z.string(),
            messages: z.number().int(),
            person_id: Id.optional(),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Someone who wrote on the account (in `contacts.seen`, with no one's address yet) kept as a person: the owner
   * ("this is me"), or a contact the owner has not reviewed, so listing them answers them no more than before.
   */
  "contacts.keep": deferMethod({
    params: () =>
      z
        .object({
          channel: z.string().min(1).max(32),
          address: z.string().min(1).max(200),
          as: z.enum(["contact", "owner"]),
          relation: PersonRelation.optional(),
        })
        .strict(),
    result: () => Person,
    effect: true,
    access: "human",
  }),
  /**
   * The owner's own Claude Code or Codex sessions on this machine (read from ~/.claude, ~/.codex), newest first;
   * those APX already goes on with are left out (they are its chats).
   */
  "sessions.native": deferMethod({
    params: () =>
      z.object({ engine: z.enum(["claude", "codex"]), limit: z.number().int().min(1).max(300).optional() }).strict(),
    result: () =>
      z.object({
        sessions: z.array(z.object({ id: z.string(), title: z.string(), cwd: z.string(), updated_at: z.string() })),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Goes on with one of those sessions in APX: a chat with that engine itself, in the session's folder, with what was
   * said there; the engine picks up its own session. Again: the chat it already has.
   */
  "sessions.resume": deferMethod({
    params: () => z.object({ engine: z.enum(["claude", "codex"]), id: z.string().min(1).max(120) }).strict(),
    result: () => Thread,
    effect: true,
    access: "human",
  }),
  /**
   * The engine's work on this machine grouped by project (Codex's own projects, else the folders sessions ran in),
   * newest first; `project_id` when APX already has that folder, `thread` for a session already brought in.
   */
  "sessions.projects": deferMethod({
    params: () => z.object({ engine: z.enum(["claude", "codex"]) }).strict(),
    result: () =>
      z.object({
        projects: z.array(
          z.object({
            name: z.string(),
            cwd: z.string(),
            project_id: Id.optional(),
            sessions: z.array(
              z.object({ id: z.string(), title: z.string(), updated_at: z.string(), thread: Id.optional() }),
            ),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Brings a project's sessions (all, or `sessions`) into APX: the folder becomes a project if it is not one, each
   * session a chat with its whole history, images, artifacts (as widgets) and documents, answered by the project's
   * orchestrator (else the super-agent) until an agent of its area takes it (sessions.adopt). Again: only what is new.
   * `pages` are the HTML files those sessions wrote (surfaces.import_page).
   */
  "sessions.import": deferMethod({
    params: () =>
      z
        .object({
          engine: z.enum(["claude", "codex"]),
          cwd: z.string().min(1).max(1000),
          sessions: z.array(z.string().min(1).max(120)).max(500).optional(),
          name: z.string().trim().min(1).max(80).optional(),
          /**
           * The project's MCP servers, memory notes, open tasks and automations too (default). Servers whose file holds
           * a credential are only listed (`need_values`); automations come as routines turned off.
           */
          extras: z.boolean().default(true),
        })
        .strict(),
    result: () =>
      z.object({
        project: z.object({ id: Id, name: z.string() }),
        extras: z
          .object({
            mcps: z.object({
              added: z.array(z.string()),
              existing: z.array(z.string()),
              need_values: z.array(z.object({ name: z.string(), keys: z.array(z.string()) })),
            }),
            notes: z.number().int(),
            tasks: z.number().int(),
            routines: z.array(z.string()),
            /** What APX refused, with why (a note that reads as a credential); the next import tries it again. */
            skipped: z.array(z.string()),
          })
          .optional(),
        chats: z.array(
          z.object({
            thread: Id,
            session: z.string(),
            title: z.string(),
            added: z.number().int(),
            created: z.boolean(),
          }),
        ),
        pages: z.array(z.string()),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * What an imported chat is about, for the agent that takes it over: the owner's opening framing word for word, then
   * its role, recurring tasks, formats, preferences, facts, open work. Written once by the auxiliary model; `refresh`
   * writes it again.
   */
  "sessions.digest": deferMethod({
    params: () => z.object({ thread: Id, refresh: z.boolean().optional() }).strict(),
    result: () => z.object({ thread: Id, title: z.string(), digest: z.string(), at: z.string() }),
    effect: true,
    access: "human",
  }),
  /** An agent takes an imported chat over: it answers there from now on, and the earlier answers show as its own. */
  "sessions.adopt": deferMethod({
    params: () => z.object({ thread: Id, agent: z.string().min(1).max(120) }).strict(),
    result: () => Thread,
    effect: true,
    access: "human",
  }),
  "pairing.list": deferMethod({
    params: () => z.object({}).strict(),
    result: () => z.object({ requests: z.array(PairingRequest) }),
    effect: false,
    access: "human",
  }),
  /**
   * Approves a stranger's code: as the owner (this address is you), as a new contact (`name`), or as another address
   * of an existing person (`person`). `deny` drops it.
   */
  "pairing.respond": deferMethod({
    params: () =>
      z
        .object({
          code: z.string().min(4).max(12),
          decision: z.enum(["owner", "contact", "deny"]),
          person: Id.optional(),
          name: z.string().trim().min(1).max(80).optional(),
        })
        .strict(),
    result: () => z.object({ person: Person.optional() }),
    effect: true,
    access: "human",
  }),
  /** An agent's runs, newest first (its activity), with the title and kind of each run's thread. */
  "runs.list": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
          limit: z.number().int().min(1).max(100).default(30),
          before: z.string().max(40).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        runs: z.array(Run),
        threads: z.array(z.object({ id: Id, title: z.string(), kind: z.string() })),
      }),
    effect: false,
    access: "human",
  }),
  "runs.get": deferMethod({
    params: () => z.object({ run: Id }).strict(),
    result: () => Run,
    effect: false,
  }),
  /** What the model received on the run's first call; only the latest runs are kept (RUN_CONTEXTS_KEPT). */
  "runs.context": deferMethod({
    params: () => z.object({ run: Id }).strict(),
    result: () => RunContext,
    effect: false,
    access: "human",
  }),
  /** Waits until the run ends or `timeout_s` passes, and returns it as it is then. */
  "runs.wait": deferMethod({
    params: () => z.object({ run: Id, timeout_s: z.number().int().min(1).max(600).default(60) }).strict(),
    result: () => Run,
    effect: false,
  }),
  /** Whether this chat's answers on a channel also go as voice notes. An agent changes only its own thread. */
  "threads.voice": deferMethod({
    params: () => z.object({ thread: Id, on: z.boolean() }).strict(),
    result: () => z.object({ on: z.boolean() }),
    effect: true,
  }),
  /**
   * Binds a chat to the Flow editor the owner has open: each of their turns there tells the agent which Flow it draws
   * (or, while it isn't made, in which project), in the turn's input. `null` unbinds it.
   */
  "threads.flow_editor": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          editor: z
            .object({ project: Id, flow: z.string().min(1).max(100).optional() })
            .strict()
            .nullable(),
        })
        .strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  }),
  "threads.cancel": deferMethod({
    params: () => z.object({ thread: Id }).strict(),
    result: () => z.object({ canceled: z.number().int() }),
    effect: true,
  }),
  /**
   * Lets agents go on in the conversation tree `thread` is in, after the breaker paused it: `reset` gives them a fresh
   * budget from now, `release` no limit until the owner writes there again. Tasks given while paused start, and chats
   * that kept a result go on. `started`: the turns that began.
   */
  "threads.go_on": deferMethod({
    params: () => z.object({ thread: Id, mode: z.enum(["reset", "release"]) }).strict(),
    result: () => z.object({ started: z.number().int() }),
    effect: true,
    access: "human",
  }),
  /**
   * Summarizes the thread's older turns now (APX's own loop sees the summary plus the newest turns verbatim). Claude
   * Code and Codex keep and compact their own transcript.
   */
  "threads.compact": deferMethod({
    params: () => z.object({ thread: Id }).strict(),
    result: () => z.object({ compacted: z.boolean(), reason: z.string().optional() }),
    effect: true,
    access: "human",
  }),
  /**
   * A side question to the chat's agent, on the chat's model, with the chat as read-only context: neither the question
   * nor the answer enters the chat or its later turns. `earlier`: this side conversation's previous exchanges, oldest
   * first. No tools; only its tokens are kept (usage, "aside"). Not in an engine's own session.
   */
  "threads.aside": deferMethod({
    params: () =>
      z
        .object({
          thread: Id,
          question: z.string().trim().min(1).max(4000),
          earlier: z
            .array(z.object({ question: z.string().max(4000), answer: z.string().max(20_000) }).strict())
            .max(10)
            .optional(),
        })
        .strict(),
    result: () => z.object({ answer: z.string(), model: z.string() }),
    effect: true,
    access: "human",
  }),
  /** The owner saw the thread: its unread count and its notices (not pending questions) are cleared. */
  /** Messages whose text has every word typed (each also as a prefix), best first: for the search box. */
  "threads.search": deferMethod({
    params: () =>
      z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(20) }).strict(),
    result: () =>
      z.object({
        hits: z.array(
          z.object({
            thread_id: Id,
            message_id: Id,
            seq: z.number().int(),
            author: Author,
            snippet: z.string(),
            created_at: z.string(),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  "threads.read": deferMethod({
    params: () => z.object({ thread: Id }).strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  }),
  /**
   * Every widget, or with `project_id` only that project's (the global ones are listed without it). `inherited`, with
   * a subproject's `project_id`: also the apps of its parent (the base project's: the global ones) under a name it does
   * not use itself; their `project_id` says whose they are.
   */
  "surfaces.list": deferMethod({
    params: () => z.object({ project_id: Id.optional(), inherited: z.boolean().default(false) }).strict(),
    result: () => z.object({ surfaces: z.array(SurfaceSummary) }),
    effect: false,
  }),
  "surfaces.get": deferMethod({
    params: () => z.object({ surface: Id }).strict(),
    result: () => Surface,
    effect: false,
  }),
} as const;
