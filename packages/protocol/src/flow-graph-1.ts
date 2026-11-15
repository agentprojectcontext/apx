import { z } from "zod";
import { FLOW_CASE_RULES, FLOW_COMPARE_OPS, FLOW_COMPARE_TYPES } from "./flow-cases.ts";
import { schemaFields } from "./schema-fields.ts";

export const FlowId = z.string().min(1).max(100);
export const FlowNodeId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const Segment = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
export const FlowPath = z.array(Segment).max(16);
const JsonLiteral = z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]);
export const FlowBinding = z.discriminatedUnion("kind", [
  z
    .object(
      schemaFields({
        kind: () => z.literal("literal"),
        value: () => JsonLiteral,
      }),
    )
    .strict(),
  z
    .object(
      schemaFields({
        kind: () => z.literal("event"),
        path: () => FlowPath,
      }),
    )
    .strict(),
  z
    .object(
      schemaFields({
        kind: () => z.literal("node"),
        node: () => FlowNodeId,
        path: () => FlowPath,
      }),
    )
    .strict(),
]);
export type FlowBinding = z.infer<typeof FlowBinding>;
/** A model as `engine/model#effort` (domain.ts ModelRef): the engine is the harness that runs it. */
export const FlowModelRef = z
  .string()
  .regex(/^(acp:)?[a-z0-9][a-z0-9._-]*(\/[^#]+)?(#[a-z0-9-]+)?$/i)
  .max(200);
/** A table of the Flow's project, by name: lowercase letters, digits, `_` and `-` (DECISIONS.md#d-173). */
export const FlowTableName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
/**
 * A column of a project's table, read by later steps as `$steps.<read>.<column>` (DECISIONS.md#d-176): letters,
 * digits, `_` and `-`; `rows` and `row` are what a read returns besides its columns.
 */
export const FlowColumnName = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/)
  .refine((value) => !["rows", "row", "__proto__", "constructor", "prototype"].includes(value), "a reserved name");
/** At most this many columns in a table. */
export const FLOW_TABLE_COLUMNS = 50;
/** An HTTP method a webhook trigger answers. */
export const FlowHookMethod = z.enum(["POST", "GET"]);
export type FlowHookMethod = z.infer<typeof FlowHookMethod>;
/** A way out of a check: a case's id, or "no" for "otherwise" (a yes/no check is the two-case default). */
export const FlowBranchId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
/** A name later steps read as `$vars.name`, or a SQL parameter's `:name`. */
export const FlowVarName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
/**
 * What a step's settings may hold. A drawing that runs needs every setting filled (`STRICT`); a draft keeps what the
 * person or agent has so far, empty settings included (`DRAFT`), and the same shape otherwise (DECISIONS.md#d-177).
 */
export type Fill = {
  /** Text a step needs to run, at least `min` characters (one by default). */
  text: (max: number, min?: number) => z.ZodType<string>;
  /** A name or identifier a step needs to run, in its own format. */
  name: (schema: z.ZodType<string>) => z.ZodType<string>;
};
export const STRICT: Fill = { text: (max, min = 1) => z.string().min(min).max(max), name: (schema) => schema };
export const DRAFT: Fill = { text: (max) => z.string().max(max), name: (schema) => z.union([schema, z.literal("")]) };

export function stepContext(fill: Fill) {
  const Base = { id: FlowNodeId, label: z.string().min(1).max(120) };
  /** A small expression over `$trigger`, `$steps.<step>` and `$vars.<name>` (domain/flow-expr.ts): never code. */
  const FlowExpr = fill.text(1000);
  /**
   * One comparison of a case (DECISIONS.md#d-180): `left` and `right` are templates (`$steps.normalize.username`,
   * text, or both), compared as `type` says; `empty` and `not_empty` read no `right`.
   */
  const FlowComparison = z
    .object(
      schemaFields({
        left: () => fill.text(1000),
        op: () => z.enum(FLOW_COMPARE_OPS),
        right: () => z.string().max(1000),
        type: () => z.enum(FLOW_COMPARE_TYPES),
      }),
    )
    .strict();
  const Rules = z.array(FlowComparison).min(1).max(FLOW_CASE_RULES);
  const FlowCase = z
    .object(
      schemaFields({
        id: () => FlowBranchId,
        label: () => z.string().max(60),
        /**
         * `equals`: the check's input is this value; `expr`: the expression comes out true; `all`/`any`: every
         * comparison holds, or at least one.
         */
        match: () =>
          z.discriminatedUnion("kind", [
            z
              .object(
                schemaFields({
                  kind: () => z.literal("equals"),
                  value: () => JsonLiteral,
                }),
              )
              .strict(),
            z
              .object(
                schemaFields({
                  kind: () => z.literal("expr"),
                  expr: () => FlowExpr,
                }),
              )
              .strict(),
            z
              .object(
                schemaFields({
                  kind: () => z.literal("all"),
                  rules: () => Rules,
                }),
              )
              .strict(),
            z
              .object(
                schemaFields({
                  kind: () => z.literal("any"),
                  rules: () => Rules,
                }),
              )
              .strict(),
          ]),
      }),
    )
    .strict();
  return { fill, Base, FlowExpr, FlowComparison, Rules, FlowCase };
}
export type StepContext = ReturnType<typeof stepContext>;

export function webhookStep(context: StepContext) {
  const { Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("webhook"),
        methods: () =>
          z
            .array(FlowHookMethod)
            .min(1)
            .max(2)
            .refine((m) => new Set(m).size === m.length, "each method once")
            .optional(),
      }),
    )
    .strict();
}

export function scheduleStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("schedule"),
        cron: () => fill.text(400, 9),
      }),
    )
    .strict();
}

export function conditionStep(context: StepContext) {
  const { Base, FlowCase } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("condition"),
        input: () => FlowBinding,
        equals: () => JsonLiteral.optional(),
        cases: () => z.array(FlowCase).min(1).max(15).optional(),
      }),
    )
    .strict();
}

export function varsStep(context: StepContext) {
  const { fill, Base, FlowExpr } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("vars"),
        vars: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    name: () => fill.name(FlowVarName),
                    value: () =>
                      z.discriminatedUnion("kind", [
                        z
                          .object(
                            schemaFields({
                              kind: () => z.literal("literal"),
                              value: () => JsonLiteral,
                            }),
                          )
                          .strict(),
                        z
                          .object(
                            schemaFields({
                              kind: () => z.literal("expr"),
                              expr: () => FlowExpr,
                            }),
                          )
                          .strict(),
                      ]),
                  }),
                )
                .strict(),
            )
            .min(1)
            .max(16),
      }),
    )
    .strict();
}

export function jsStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("js"),
        code: () => fill.text(8000),
        input: () => FlowBinding,
        timeoutMs: () => z.number().int().min(100).max(10000),
      }),
    )
    .strict();
}

export function sqlStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("sql"),
        database: () => fill.text(500),
        mode: () => z.enum(["read", "write"]),
        query: () => fill.text(8000),
        params: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    name: () => fill.name(FlowVarName),
                    value: () => z.string().max(2000),
                  }),
                )
                .strict(),
            )
            .max(32),
        maxRows: () => z.number().int().min(1).max(500),
        timeoutMs: () => z.number().int().min(1000).max(30000),
      }),
    )
    .strict();
}

export function cmdStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("cmd"),
        command: () => fill.text(4000),
        env: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    name: () => fill.name(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)),
                    value: () => z.string().max(4000),
                  }),
                )
                .strict(),
            )
            .max(16),
        stdin: () => z.string().max(16000),
        timeoutMs: () => z.number().int().min(1000).max(120000),
        /** On, a command that exits with an error still succeeds, so a check can read its exit code. */
        continueOnError: () => z.boolean(),
      }),
    )
    .strict();
}

export function tableReadStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("table_read"),
        /** A table of the project; absent, the Flow's own table (a definition drawn as a graph). */
        table: () => FlowTableName.optional(),
        /** Keys to read, each may hold placeholders; empty when it reads the `latest` rows. */
        keys: () => z.array(fill.text(128)).max(16),
        latest: () => z.number().int().min(1).max(100).optional(),
        /** The columns it brings, in the table's order; absent, every column (DECISIONS.md#d-180). */
        columns: () => z.array(FlowColumnName).max(FLOW_TABLE_COLUMNS).optional(),
      }),
    )
    .strict();
}

export function tableWriteStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("table_write"),
        table: () => FlowTableName.optional(),
        /** The row's key; may hold placeholders (`$trigger.email`), filled when the step runs. */
        key: () => fill.text(128),
        /** What it saves as a whole; a save with `columns` has none. */
        value: () => FlowBinding.optional(),
        /**
         * A value for each column, a template each: one placeholder alone saves that value as it is, anything else as
         * text. Saving again under the key changes only these columns (DECISIONS.md#d-176).
         */
        columns: () =>
          z
            .array(
              z
                .object(
                  schemaFields({
                    name: () => fill.name(FlowColumnName),
                    value: () => z.string().max(8000),
                  }),
                )
                .strict(),
            )
            .max(FLOW_TABLE_COLUMNS)
            .optional(),
      }),
    )
    .strict();
}

export function llmStep(context: StepContext) {
  const { fill, Base } = context;
  return z
    .object(
      schemaFields({
        ...Base,
        kind: () => z.literal("llm"),
        model: () => fill.text(200),
        prompt: () => fill.text(8000),
        input: () => FlowBinding,
        maxOutputTokens: () => z.number().int().min(1).max(2048),
        timeoutMs: () => z.number().int().min(1000).max(120000),
      }),
    )
    .strict();
}
