import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { Id, ToolApproval } from "./domain.ts";
import {
  ImportTarget,
  SecretInfo,
  SecretSite,
  SkillCandidate,
  SkillImportSource,
  SkillInfo,
  SkillName,
} from "./resource-methods-schemas.ts";
export const resourceMethodsPart1 = {
  /** Names and usage, never values; with project, one effective entry per name (project, parent, global). */
  "secrets.list": deferMethod({
    params: () =>
      z
        .object({
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        secrets: z.array(SecretInfo),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * One variable's value, for the owner's eyes only (the eye in Resources › Variables): never an agent's, never in a
   * prompt or a log.
   */
  /** The sites where agents may sign in with a stored secret; an empty list takes them all away. */
  "secrets.set_sites": deferMethod({
    params: () =>
      z
        .object({
          name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
          project: Id.optional(),
          sites: z.array(SecretSite).max(64),
        })
        .strict(),
    result: () =>
      z.object({
        sites: z.array(SecretSite),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Moves a stored variable to another project, or to the global ones (`to: null`); its value never leaves the core.
   * References stay `secret://NAME`: what uses it finds it wherever it now lives. Refused when the other place already
   * has one of that name.
   */
  "secrets.move": deferMethod({
    params: () =>
      z
        .object({
          name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
          project: Id.optional(),
          to: Id.nullable(),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  "secrets.reveal": deferMethod({
    params: () =>
      z
        .object({
          name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        value: z.string(),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Skills agents can load: APX's own, the owner's (APX home `skills/`), a project's `.apc/skills/` with `project`, and enabled
   * extensions'. Skills the owner turned off are listed with `on: false`; agents do not see them.
   */
  "skills.list": deferMethod({
    params: () =>
      z
        .object({
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        skills: z.array(SkillInfo),
      }),
    effect: false,
  }),
  "skills.get": deferMethod({
    params: () =>
      z
        .object({
          name: SkillName,
          project: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        skill: SkillInfo,
        content: z.string(),
        files: z.array(z.string()),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Writes a skill's SKILL.md: the owner's (`global`) or the project's (`project`). Saving a global skill as `project`
   * makes the project's own copy, which takes its place there and leaves the original untouched.
   */
  "skills.save": deferMethod({
    params: () =>
      z
        .object({
          name: SkillName,
          target: z.enum(["global", "project"]),
          project: Id.optional(),
          content: z.string().min(1).max(200000),
        })
        .strict(),
    result: () =>
      z.object({
        skill: SkillInfo,
      }),
    effect: true,
    access: "human",
  }),
  /** Turns a skill off (or back on) everywhere, or only inside one project. */
  "skills.toggle": deferMethod({
    params: () =>
      z
        .object({
          name: SkillName,
          project: Id.optional(),
          on: z.boolean(),
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
   * Copies APX's skills for other agent apps (Claude Code, Codex, Cursor, ~/.agents) into each one installed, as the
   * core does at every start; `dry_run` only says what it would do. Other skills in those folders are left alone.
   */
  "skills.runtimes": deferMethod({
    params: () =>
      z
        .object({
          dry_run: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        steps: z.array(
          z.object({
            runtime: z.string(),
            name: z.string(),
            dir: z.string(),
            action: z.enum(["create", "update", "unchanged", "remove", "skip-link"]),
          }),
        ),
        missing: z.array(
          z.object({
            runtime: z.string(),
            dir: z.string(),
          }),
        ),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Reads a folder, .zip or git repository and lists the skills in it, with their files and what to look at before
   * importing. Nothing is run and nothing is kept: a zip or a clone is read in a temporary folder and removed.
   */
  "skills.preview": deferMethod({
    params: () =>
      z
        .object({
          source: SkillImportSource,
          ...ImportTarget,
        })
        .strict(),
    result: () =>
      z.object({
        candidates: z.array(SkillCandidate),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Copies the picked skills (by candidate id) into APX's skills or a project's `.apc/skills/`: regular files only, no
   * links, nothing run. A taken folder is kept unless `replace`.
   */
  "skills.import": deferMethod({
    params: () =>
      z
        .object({
          source: SkillImportSource,
          ...ImportTarget,
          pick: z.array(z.string().max(500)).min(1).max(100),
          replace: z.boolean().default(false),
        })
        .strict(),
    result: () =>
      z.object({
        imported: z.array(SkillInfo),
        skipped: z.array(
          z.object({
            id: z.string(),
            reason: z.string(),
          }),
        ),
      }),
    effect: true,
    access: "human",
  }),
  /** Whether a project takes the owner's global skills and MCP servers (each can still be turned off one by one). */
  "resources.inheritance": deferMethod({
    params: () =>
      z
        .object({
          project: Id,
        })
        .strict(),
    result: () =>
      z.object({
        skills: z.boolean(),
        mcp: z.boolean(),
      }),
    effect: false,
    access: "human",
  }),
  /** A project takes the owner's global skills (or MCP servers), or none of them: only its own count there. */
  "resources.inherit": deferMethod({
    params: () =>
      z
        .object({
          project: Id,
          kind: z.enum(["skills", "mcp"]),
          on: z.boolean(),
        })
        .strict(),
    result: () =>
      z.object({
        skills: z.boolean(),
        mcp: z.boolean(),
      }),
    effect: true,
    access: "human",
  }),
  /** MCP servers: the owner's and each project's, with whether they are approved, running and on here. */
  "tools.approvals": deferMethod({
    params: () =>
      z
        .object({
          thread: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        approvals: z.array(ToolApproval),
      }),
    effect: false,
    access: "human",
  }),
  "tools.revoke": deferMethod({
    params: () =>
      z
        .object({
          key: z.string().min(1),
          thread: Id.optional(),
          agent: Id.optional(),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
} as const;
