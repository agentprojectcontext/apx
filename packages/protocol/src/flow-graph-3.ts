import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { FlowId, FlowNodeId } from "./flow-graph-1.ts";
import {
  FlowDraftGraph,
  FlowGraph,
  FlowGraphDocument,
  FlowGraphIssue,
  FlowRunDetail,
  FlowRunState,
} from "./flow-graph-2.ts";

/**
 * Reading a drawing, checking it and saving a draft are open to an agent's own tool for Flows of its project (a global
 * agent's: any), never to an outside app, a channel or an agent's shell: a draft runs nothing until the owner publishes
 * it (DECISIONS.md#d-174). Publishing, discarding, running and stopping stay the owner's.
 */
export const flowGraphMethods = {
  "flows.graph_get": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
        })
        .strict(),
    result: () => FlowGraphDocument,
    effect: false,
  }),
  "flows.draft_save": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          expectedVersion: z.number().int().min(1).nullable(),
          /** As drawn so far: a step's settings may still be empty, publishing asks for them. */
          graph: FlowDraftGraph,
          /**
           * The owner's edits saved over an agent's draft they have not saved from the editor yet (its chat saves them
           * before each message): the draft keeps that agent as who drew it, so it still waits for the owner's review.
           */
          unreviewed: z.literal(true).optional(),
        })
        .strict(),
    result: () => FlowGraphDocument,
    effect: true,
  }),
  "flows.draft_discard": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          expectedVersion: z.number().int().min(1),
          confirm: z.literal(true),
        })
        .strict(),
    result: () => FlowGraphDocument,
    effect: true,
    access: "human",
  }),
  /** A new Flow, not saved yet, is checked against the project it will belong to. */
  "flows.validate": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId.optional(),
          project: FlowId.optional(),
          graph: FlowDraftGraph,
        })
        .strict()
        .refine((p) => (p.flow === undefined) !== (p.project === undefined), "Pass a flow or a project"),
    result: () =>
      z
        .object({
          valid: z.boolean(),
          issues: z.array(FlowGraphIssue),
        })
        .strict(),
    effect: false,
  }),
  /** One graph run step by step; legacy events have no steps (use `flows.events`). */
  "flows.run_get": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          event: z.string().min(1).max(256),
        })
        .strict(),
    result: () => FlowRunDetail,
    effect: false,
    access: "human",
  }),
  /** When a cron fires next in the owner's time zone; `error` says why it can't be used. */
  "flows.next_runs": deferMethod({
    params: () =>
      z
        .object({
          cron: z.string().min(1).max(400),
        })
        .strict(),
    result: () =>
      z
        .object({
          next: z.array(z.string()).max(3),
          time_zone: z.string(),
          error: z.enum(["invalid", "too_often"]).nullable(),
        })
        .strict(),
    effect: false,
    access: "human",
  }),
  /**
   * Starts a published, enabled Flow now through the same admission as its trigger: a schedule Flow with an empty
   * event, a webhook Flow with the sample body given (untrusted, like any payload).
   */
  "flows.run_now": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          data: z.unknown().optional(),
        })
        .strict(),
    result: () =>
      z
        .object({
          event: z.string(),
          state: z.enum(["pending", "ignored", "duplicate"]),
        })
        .strict(),
    effect: true,
    access: "human",
  }),
  /**
   * Tests the saved drawing (the draft, or what runs when there is none) with a real event, the Flow on or off
   * (DECISIONS.md#d-178). A webhook Flow waits up to five minutes for one POST to `/flows/test/<path>`; a schedule
   * Flow runs once now with no data. `outward` is what `flows.outward` lists for that drawing, as for publishing: a
   * test sends, calls, runs and writes for real.
   */
  "flows.test_start": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          expectedDraftVersion: z.number().int().min(1).nullable(),
          outward: z.array(z.string().max(2400)).max(160).optional(),
        })
        .strict(),
    result: () =>
      z
        .object({
          /** While it waits: when it stops waiting, and the address to send to (path only; the host is the owner's). */
          listening: z
            .object({
              until: z.string(),
              path: z.string(),
            })
            .strict()
            .nullable(),
          /** A schedule Flow's run, started at once. */
          event: z.string().nullable(),
        })
        .strict(),
    effect: true,
    access: "human",
  }),
  /** Stops waiting for a test event; a test run already going goes on (`flows.cancel_run` stops it). */
  "flows.test_stop": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
        })
        .strict(),
    result: () =>
      z
        .object({
          stopped: z.boolean(),
        })
        .strict(),
    effect: true,
    access: "human",
  }),
  /** Stops a run that is going: pending steps are cancelled, a model call already sent is left to look at. */
  "flows.cancel_run": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          event: z.string().min(1).max(256),
        })
        .strict(),
    result: () =>
      z
        .object({
          cancelled: z.boolean(),
          state: FlowRunState.nullable(),
        })
        .strict(),
    effect: true,
    access: "human",
  }),
  /**
   * What a drawing would do with this data: checks and bindings as a run evaluates them. Reads no table, saves
   * nothing, calls no model and starts no run; steps that do work say they would run.
   */
  "flows.try_graph": deferMethod({
    params: () =>
      z
        .object({
          graph: FlowGraph,
          data: z.unknown(),
        })
        .strict(),
    result: () =>
      z
        .object({
          steps: z.array(
            z
              .object({
                node: FlowNodeId,
                state: z.enum(["ran", "would_run", "skipped", "unknown", "missing"]),
                matched: z.boolean().nullable(),
                /** A check that ran: the way out it took (a case's id, or "no"). */
                branch: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    effect: false,
    access: "human",
  }),
  /**
   * Where a drawing would send as the owner, which hosts it would call, the commands it would run and the databases it
   * would change, in words to show before publishing.
   */
  "flows.outward": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          graph: FlowGraph,
        })
        .strict(),
    result: () =>
      z
        .object({
          /** Keys to pass back to `flows.publish` once the owner has seen them. */
          keys: z.array(z.string()),
          /** `owner`: it goes to the owner themselves; `type` is the channel's kind, for its icon. */
          sends: z.array(
            z
              .object({
                node: FlowNodeId,
                channel: z.string(),
                type: z.string(),
                to: z.string(),
                owner: z.boolean(),
              })
              .strict(),
          ),
          /** `secrets`: the names of the secrets it sends to that address. */
          calls: z.array(
            z
              .object({
                node: FlowNodeId,
                method: z.string(),
                host: z.string(),
                secrets: z.array(z.string()),
              })
              .strict(),
          ),
          /** Commands it runs on this computer, in the project's folder; `secrets`: those in its environment. */
          commands: z.array(
            z
              .object({
                node: FlowNodeId,
                command: z.string(),
                folder: z.string(),
                secrets: z.array(z.string()),
              })
              .strict(),
          ),
          /** Database files it changes. */
          writes: z.array(
            z
              .object({
                node: FlowNodeId,
                database: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    effect: false,
    access: "human",
  }),
  "flows.publish": deferMethod({
    params: () =>
      z
        .object({
          flow: FlowId,
          expectedDraftVersion: z.number().int().min(1),
          expectedPublishedRevision: z.number().int().min(1).nullable(),
          /**
           * Where the drawing sends and which hosts it calls, as `flows.outward` lists them for this draft: the owner saw
           * them before it runs. Required, and must match, when the draft has notify, http, cmd or SQL write steps.
           */
          outward: z.array(z.string().max(2400)).max(160).optional(),
        })
        .strict(),
    result: () => FlowGraphDocument,
    effect: true,
    access: "human",
  }),
} as const;
