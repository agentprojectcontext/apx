// Methods behind the app screens.
import { z } from "zod";
import { MemoryJobs, V1Group } from "./app-method-schemas.ts";
import { composerMethods } from "./composer-methods.ts";
import { deferMethod } from "./defer-method.ts";
import {
  Agent,
  AgentListing,
  AgentRules,
  Autonomy,
  CatalogEngine,
  EngineStatus,
  Id,
  ModelAnnouncement,
  ModelChoice,
  RouterConfig,
  ToolApproval,
  ToolRisk,
} from "./domain.ts";
import { extensionMethods } from "./extension-methods.ts";
import { filesMethods } from "./files-methods.ts";
import { gitMethods } from "./git-methods.ts";
import { officeMethods } from "./office-methods.ts";
import { resourceMethods } from "./resource-methods.ts";
import { SecretField } from "./resource-methods-schemas.ts";
import { teamMethods } from "./team-methods.ts";

/** What a simple setup leaves ready on its own: memory by meaning, APX's voice for notes and calls, images. */
export const SetupPrepare = z.object({
  /** The setup asked for it (until then each part only says where it stands). */
  started: z.boolean(),
  items: z.array(
    z.object({
      id: z.enum(["memory", "voice", "images"]),
      state: z.enum(["waiting", "working", "done", "skipped", "failed"]),
      /** 0–1 while something downloads, when its size is known. */
      progress: z.number().min(0).max(1).optional(),
      /** Why a part is left out: no Ollama here, a machine that cannot run the voice, no ChatGPT plan. */
      reason: z.enum(["no-ollama", "machine", "no-chatgpt"]).optional(),
      error: z.string().optional(),
      /** What does the work once it is ready: memory's embedding engine and model ("Ollama · bge-m3"). */
      detail: z.string().optional(),
    }),
  ),
});
export type SetupPrepare = z.infer<typeof SetupPrepare>;

/** Simple: an assistant for the owner's day, without projects; advanced: projects, a team and every setting. */
export const PanelMode = z.enum(["simple", "advanced"]);
export type PanelMode = z.infer<typeof PanelMode>;

export const appSetupMethods = {
  "panel.mode": deferMethod({
    params: () => z.object({}).strict(),
    result: () => z.object({ mode: PanelMode }),
    effect: false,
    access: "human",
  }),
  /** Switches every panel of this APX between simple and advanced; the super-agent may do it at the owner's word. */
  "panel.set_mode": deferMethod({
    params: () => z.object({ mode: PanelMode }).strict(),
    result: () => z.object({ mode: PanelMode }),
    effect: true,
    access: "human",
  }),
  /**
   * Leaves ready what this machine can run without asking: an embedding model through Ollama (memory then searches
   * by meaning), APX's own voice (voice notes and calls), images with the ChatGPT plan. Starts once; downloads go on
   * in the background, and the result says where each part stands.
   */
  /**
   * The owner answered one question of getting to know them (a choices card in the super-agent's chat): kept where it
   * belongs and shown as their words, then the next question. After the last one `say` comes back for the panel to
   * send as the owner's message, so the agent answers it.
   */
  "setup.onboard": deferMethod({
    params: () =>
      z
        .object({
          step: z.enum(["name", "work", "personality", "help"]),
          answer: z.string().trim().min(1).max(1000),
        })
        .strict(),
    result: () =>
      z.object({
        next: z.enum(["name", "work", "personality", "help"]).optional(),
        say: z.string().optional(),
      }),
    effect: true,
    access: "human",
  }),
  "setup.prepare": deferMethod({
    params: () => z.object({}).strict(),
    result: () => SetupPrepare,
    effect: true,
    access: "human",
  }),
  "setup.prepare_status": deferMethod({
    params: () => z.object({}).strict(),
    result: () => SetupPrepare,
    effect: false,
    access: "human",
  }),
  "memory.status": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        jobs: MemoryJobs,
      }),
    effect: false,
    access: "human",
  }),
  ...officeMethods,
  ...extensionMethods,
  ...teamMethods,
  ...resourceMethods,
  ...composerMethods,
  ...filesMethods,
  ...gitMethods,
  /**
   * Read-only import from a local APX v1: registers the project folders it knows (their .apc/ is read from disk)
   * and, when asked, copies once into v2's own home: its model API keys (`keys`), its skills (`skills`), and its image
   * engines and voices (`services`).
   */
  /**
   * Where the owner is in the first-run setup: done or not, whether this install is new (nothing said in it yet) and
   * the APX v1 found on this machine, if any (counts only).
   */
  "setup.status": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        done: z.boolean(),
        fresh: z.boolean(),
        v1: z
          .object({
            home: z.string(),
            version: z.string().optional(),
            agent_name: z.string().optional(),
            /** The super-agent's face in v1 (a blob name), shown before the import brings it. */
            agent_blob: z.string().optional(),
            owner_name: z.string().optional(),
            projects: z.number().int(),
          })
          .nullable(),
        /** This APX's own home, where its data lives (as the owner knows it: ~/…). */
        home: z.string(),
        /** The folder of this APX's command (apps/terminal), to put `apx` on the PATH from there. */
        terminal: z.string().optional(),
        /** APX v1's daemon still answers beside this one: routines and bots would run twice. */
        v1_running: z.boolean().optional(),
      }),
    effect: false,
    access: "human",
  }),
  /** What APX v1 has, per group: how many (and, for projects, their agents; for channels, their contacts). */
  "setup.v1_scan": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        groups: z.array(
          z.object({
            id: V1Group,
            count: z.number().int(),
            detail: z.string().optional(),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Brings the chosen v1 groups into v2, reading v1's folder only. Routines come in off (v1 may still run them); a
   * Telegram bot v2 already has stays.
   */
  "setup.import_v1": deferMethod({
    params: () =>
      z
        .object({
          groups: z.array(V1Group).min(1),
        })
        .strict(),
    result: () =>
      z.object({
        imported: z.record(z.string(), z.number().int()),
        errors: z.array(z.string()),
      }),
    effect: true,
    access: "human",
  }),
  /** The setup is over: it does not open again by itself. */
  /**
   * Makes the `apx` command this APX: v1's global package is removed and this checkout's terminal is linked in its
   * place. v1's files stay where they are.
   */
  "setup.take_over_cli": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        ok: z.boolean(),
        detail: z.string(),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * The super-agent greets the owner in its chat (in `language`), asking who they are and how it should be, with a few
   * personalities to pick. Once per install, and only into an empty chat; `sent` says whether it greeted now.
   */
  "setup.greet": deferMethod({
    params: () =>
      z
        .object({
          language: z.string().regex(/^[a-z]{2}$/),
        })
        .strict(),
    result: () =>
      z.object({
        thread: Id,
        sent: z.boolean(),
      }),
    effect: true,
    access: "human",
  }),
  "setup.finish": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        done: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Whether a newer APX is out: for a checkout, commits on main it does not have; for a daemon installed from a bundle,
   * newer releases; for the core the desktop app carries (`app`), newer releases the app installs. `check` asks now.
   */
  "system.updates": deferMethod({
    params: () =>
      z
        .object({
          check: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        source: z.enum(["git", "release", "app", "none"]),
        behind: z.number().int(),
        latest: z.string().optional(),
        changes: z.array(z.string()),
        checked_at: z.string().optional(),
        error: z.string().optional(),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Brings the newer APX in: a checkout pulls (fast-forward only), installs and builds the panel; a bundle install
   * downloads the newer bundle, checks it and makes it current. `restart`: the core starts again with it now; otherwise
   * the owner restarts APX.
   */
  "system.update": deferMethod({
    params: () =>
      z
        .object({
          target: z
            .string()
            .regex(/^\d+\.\d+\.\d+$/)
            .max(40)
            .optional(),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.boolean(),
        restart: z.boolean(),
        log: z.string(),
        target: z.string().optional(),
      }),
    effect: true,
    access: "human",
  }),
  // Release news the super-agent tells the owner (DECISIONS.md#d-117).
  /** The news APX carries: whether each was told (or known from the start) and whether it applies to this owner. */
  "system.news": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        entries: z.array(
          z.object({
            id: z.string(),
            since: z.string(),
            /** The owner's words (`about`: what they can do now), in English and Spanish: the panel shows its language. */
            title: z.object({
              en: z.string(),
              es: z.string(),
            }),
            about: z.object({
              en: z.string(),
              es: z.string(),
            }),
            seen: z.boolean(),
            applies: z.boolean(),
            /** `prompt`: what asking the super-agent for it says, as the owner's words. */
            actions: z.array(
              z.object({
                label: z.object({
                  en: z.string(),
                  es: z.string(),
                }),
                prompt: z.string(),
              }),
            ),
          }),
        ),
      }),
    effect: false,
  }),
  /**
   * Tells news now, as a start would: the given entries even if told or not applying (a replay), else the unseen ones
   * that apply. `voiced`: the super-agent's model wrote it; `sent`: a channel or the phone took it.
   */
  "system.news_tell": deferMethod({
    params: () =>
      z
        .object({
          ids: z.array(z.string().max(80)).max(20).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        told: z.array(z.string()),
        thread: z.string().optional(),
        sent: z.boolean(),
        voiced: z.boolean(),
      }),
    effect: true,
    access: "human",
  }),
  "system.import_v1": deferMethod({
    params: () =>
      z
        .object({
          keys: z.boolean().default(false),
          skills: z.boolean().default(false),
          services: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        projects: z.number().int(),
        agents: z.number().int(),
        keys: z.array(z.string()),
        skills: z.array(z.string()).default([]),
        services: z.array(z.string()).default([]),
      }),
    effect: true,
    access: "human",
  }),
  "secrets.set": deferMethod({
    params: () =>
      z
        .object({
          /** The same shape `secret://NAME` references accept (an MCP env var name like GH_TOKEN works as is). */
          name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
          /** null removes it. Absent with `login`, or to change only what it is for (`field`). */
          value: z.string().min(1).max(16384).nullable().optional(),
          /**
           * A sign-in: a username and a password kept as one variable. A part left out keeps the one stored, so the
           * owner changes a password without typing the username again.
           */
          login: z
            .object({ username: z.string().max(1024).optional(), password: z.string().min(1).max(4096).optional() })
            .strict()
            .optional(),
          /** What it is for; null makes it a plain variable again. `login` sets "login". */
          field: SecretField.nullable().optional(),
          /** A project's own value, over the global one for that project's MCP servers. */
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  "agents.list": deferMethod({
    /**
     * `project_id`: only the agents that work in that project (BASE_PROJECT_ID: the base project's), its own first,
     * then the ones it takes from its parent, marked `inherited_from`.
     */
    params: () =>
      z
        .object({
          project_id: Id.optional(),
        })
        .strict(),
    /** `former`: agents archived or deleted, so the chats they spoke in still show their name and face. */
    result: () =>
      z.object({
        agents: z.array(AgentListing),
        former: z.array(Agent).default([]),
      }),
    effect: false,
  }),
  /**
   * Creates an agent. With a project it is written as .apc/agents/<slug>.md in that project's folder (the file is
   * the definition); without one it is a global agent kept by APX.
   */
  "agents.create": deferMethod({
    params: () =>
      z
        .object({
          project_id: Id.optional(),
          slug: z
            .string()
            .regex(/^[a-z][a-z0-9_-]*$/)
            .max(64),
          name: z.string().min(1).max(80),
          role: z.string().max(200).default(""),
          description: z.string().max(2000).optional(),
          prompt: z.string().max(100000).default(""),
          parent: z.string().max(64).optional(),
          blob: z.string().max(40).optional(),
          model_choice: ModelChoice.optional(),
          area: z.string().trim().max(60).optional(),
          personality: z.string().max(1000).optional(),
          orchestrator: z.boolean().optional(),
        })
        .strict(),
    result: () => Agent,
    effect: true,
    access: "human",
  }),
  /** Removes an agent: a project agent's file moves to .apc/agents/.archived/ (never deleted); threads keep it. */
  "agents.archive": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
        moved_to: z.string().optional(),
      }),
    effect: true,
    access: "human",
  }),
  /** Archived agents (every project's, or one's): the owner brings one back or deletes it for good. */
  "agents.archived": deferMethod({
    params: () =>
      z
        .object({
          project_id: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        agents: z.array(Agent),
      }),
    effect: false,
    access: "human",
  }),
  /** Brings an archived agent back: a project agent's file returns to .apc/agents/ and it shows again. */
  "agents.restore": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
        })
        .strict(),
    result: () => Agent,
    effect: true,
    access: "human",
  }),
  /** Deletes an archived agent for good: its file and its own notes go; the chats it was in keep its name. */
  "agents.delete": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * APX's own tools an agent's list may name, with the group each belongs to; `kept` ones every agent keeps. MCP
   * tools are named as `mcp_<server>_*` or one by one.
   */
  "agents.tools": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            group: z.string().optional(),
            kept: z.boolean(),
            risk: ToolRisk,
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  /** One agent with its prompt (the system prompt the owner writes; lists leave it out). */
  "agents.get": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
        })
        .strict(),
    result: () =>
      z.object({
        agent: Agent,
        prompt: z.string(),
        revision: z.string(),
      }),
    effect: false,
    access: "human",
  }),
  "agents.review_queue": deferMethod({
    params: () =>
      z
        .object({
          project_id: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        agents: z.array(
          z.object({
            agent: Id,
            name: z.string(),
            project_id: Id.optional(),
            revision: z.string(),
          }),
        ),
      }),
    effect: false,
    access: "human",
  }),
  "agents.review_ack": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
          if_revision: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  "agents.update": deferMethod({
    params: () =>
      z
        .object({
          agent: Id,
          browser_profile: z.enum(["shared", "isolated", "incognito"]).optional(),
          /** null = back to the install default. */
          model_choice: ModelChoice.nullable().optional(),
          /** Apply a reviewed proposal only if its instructions and project context are unchanged. */
          if_revision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          /** Definition fields: written to the agent's file for project agents. */
          name: z.string().min(1).max(80).optional(),
          role: z.string().max(200).optional(),
          description: z.string().max(2000).optional(),
          /** The team area it belongs to (shown as a pill on the team chart). */
          area: z.string().trim().max(60).optional(),
          prompt: z.string().max(100000).optional(),
          /** How it comes across, apart from its instructions ("" clears it). */
          personality: z.string().max(1000).optional(),
          /** How often it stops for the owner's yes; null: none of its own, as far as its project says. Owner only. */
          autonomy: Autonomy.nullable().optional(),
          parent: z.string().max(64).optional(),
          blob: z.string().max(40).optional(),
          /**
           * The tools (or groups) it uses first, the rest staying reachable when needed, and the skills it works with;
           * [] puts all of them first again.
           */
          tools: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
          skills: z.array(z.string().trim().min(1).max(120)).max(200).optional(),
          /** Runs its team (false clears it). */
          orchestrator: z.boolean().optional(),
          /** Its own rules by risk; null: none, its autonomy decides. Owner only. */
          rules: AgentRules.nullable().optional(),
          /** Renames the file (project agents); the agent keeps its id and the old slug is kept as an alias. */
          slug: z
            .string()
            .regex(/^[a-z][a-z0-9_-]*$/)
            .max(64)
            .optional(),
        })
        .strict(),
    result: () => Agent,
    effect: true,
    access: "human",
  }),
  /**
   * Narrows or changes a grant for good (one agent's, or every agent's without `agent`): only calls matching
   * `condition`, until `expires_at`. Empty strings clear them.
   */
  "tools.grant_set": deferMethod({
    params: () =>
      z
        .object({
          key: z.string().min(1),
          agent: Id.optional(),
          condition: z.string().max(200).optional(),
          expires_at: z.string().datetime().or(z.literal("")).optional(),
        })
        .strict(),
    result: () =>
      z.object({
        approval: ToolApproval,
      }),
    effect: true,
    access: "human",
  }),
  /** Every engine with the models it offers, asked to the engine (cached for a day; `refresh` asks again). */
  "models.list": deferMethod({
    params: () =>
      z
        .object({
          refresh: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        engines: z.array(CatalogEngine),
        announcements: z.array(ModelAnnouncement).optional(),
      }),
    effect: false,
  }),
  /** The install default for agents without their own choice, and the router. */
  "models.config": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        default: ModelChoice,
        router: RouterConfig,
      }),
    effect: false,
  }),
  "models.set_config": deferMethod({
    params: () =>
      z
        .object({
          default: ModelChoice.optional(),
          router: RouterConfig.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        default: ModelChoice,
        router: RouterConfig,
      }),
    effect: true,
    access: "human",
  }),
  "engines.status": deferMethod({
    params: () =>
      z
        .object({
          refresh: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        engines: z.array(EngineStatus),
      }),
    effect: false,
  }),
} as const;
