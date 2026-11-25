// A workflow's plan and the pure rules that run it: which agent calls it makes, which may start, what each is told and
// whether its JSON answer fits. The runner (engine/workflows.ts) only applies them. See DECISIONS.md#d-273
import { WritePolicy } from "@apx/protocol";
import { z } from "zod";

export const MAX_ITEMS = 24;
export const MAX_STAGES = 4;
export const MAX_PARALLEL = 4;
export const DEFAULT_PARALLEL = 3;
/** How much of one output a later stage reads, and of each item in the finish stage. */
const PREVIOUS_CHARS = 6000;
const RESULT_ITEM_CHARS = 2500;
const RESULTS_CHARS = 50_000;

/** A JSON schema as the plan gives it: a small object, checked by `checkOutput` (types, properties, items, enum). */
const JsonSchema = z
  .record(z.string(), z.unknown())
  .refine((s) => JSON.stringify(s).length <= 4000, { message: "keep the output schema under 4000 characters" });
export type JsonSchema = Record<string, unknown>;

export const Stage = z.object({
  phase: z.string().trim().min(1).max(40).describe("the phase this stage shows under on the card"),
  agent: z.string().optional().describe("agent id or unique name"),
  worker: z
    .object({
      name: z.string().min(1).max(40),
      instructions: z.string().min(1).max(8000),
      tools: z.array(z.string()).max(60).optional(),
    })
    .optional()
    .describe("a helper with your model and tools, under these instructions"),
  task: z.string().min(1).max(8000).describe("what to do; {{item}}, {{item.field}}, {{previous}}, {{results}}"),
  output: JsonSchema.optional().describe("JSON schema its answer must fit"),
  only_if: z
    .string()
    .max(60)
    .optional()
    .describe("a field of the previous stage's JSON output: the item goes on only when it is true"),
  project: z.string().max(500).optional(),
  write: WritePolicy.optional(),
});
export type Stage = z.infer<typeof Stage>;

export const Item = z.union([z.string().min(1).max(4000), z.record(z.string(), z.unknown())]);
export type Item = z.infer<typeof Item>;

export const WorkflowPlan = z
  .object({
    name: z.string().trim().min(1).max(80),
    items: z.array(Item).max(MAX_ITEMS).optional().describe("each goes through the stages on its own"),
    stages: z.array(Stage).min(1).max(MAX_STAGES),
    finish: Stage.omit({ only_if: true }).optional().describe("runs once with every item's last output"),
    parallel: z.number().int().min(1).max(MAX_PARALLEL).optional(),
  })
  .superRefine((p, ctx) => {
    for (const [i, s] of [...p.stages, ...(p.finish ? [p.finish] : [])].entries()) {
      if (Boolean(s.agent) === Boolean(s.worker))
        ctx.addIssue({
          code: "custom",
          path: ["stages", i],
          message: "each stage names an agent or a worker, not both",
        });
    }
    if (p.stages[0]?.only_if)
      ctx.addIssue({
        code: "custom",
        path: ["stages", 0],
        message: "only_if reads the previous stage: not on the first",
      });
    if (p.items && JSON.stringify(p.items).length > 40_000)
      ctx.addIssue({ code: "custom", path: ["items"], message: "keep items under 40000 characters in all" });
  });
export type WorkflowPlan = z.infer<typeof WorkflowPlan>;

const FINISH = "finish";

/** What an agent asks for: a new workflow, or one of its own to run again. */
export type WorkflowAsk = { plan: WorkflowPlan; resume?: undefined } | { resume: string; plan?: undefined };

/** One agent call: stage `stage` on item `item`, or the finish stage. */
export type StepRef = { key: string; stage: number; item: number; finish: boolean };

/** Every agent call the plan makes, stage by stage. No items is one item. */
export function stepsOf(plan: WorkflowPlan): StepRef[] {
  const items = plan.items?.length ?? 1;
  const out: StepRef[] = [];
  for (let s = 0; s < plan.stages.length; s++)
    for (let i = 0; i < items; i++) out.push({ key: keyOf(s, i), stage: s, item: i, finish: false });
  if (plan.finish) out.push({ key: FINISH, stage: plan.stages.length, item: -1, finish: true });
  return out;
}

export const keyOf = (stage: number, item: number) => `s${stage}.i${item}`;

export function refOf(plan: WorkflowPlan, key: string): StepRef | undefined {
  if (key === FINISH) return plan.finish ? { key, stage: plan.stages.length, item: -1, finish: true } : undefined;
  const m = /^s(\d+)\.i(\d+)$/.exec(key);
  if (!m) return undefined;
  const stage = Number(m[1]);
  const item = Number(m[2]);
  return stage < plan.stages.length && item < (plan.items?.length ?? 1)
    ? { key, stage, item, finish: false }
    : undefined;
}

export const stageOf = (plan: WorkflowPlan, ref: StepRef) => (ref.finish ? plan.finish : plan.stages[ref.stage]);

export type StepState = "pending" | "working" | "done" | "skipped" | "failed" | "canceled";
export const ENDED: ReadonlySet<StepState> = new Set(["done", "skipped", "failed", "canceled"]);

/** What a step needs to know of the others: their state and output. */
export type StepView = { key: string; state: StepState; output?: string | undefined };

/** A step that can no longer run: skipped (and why), or undefined when it may run or must wait. */
type Readiness = { ready: true } | { ready: false; skip?: string };

/**
 * Whether a pending step may start now. A stage waits only for the same item's previous stage (no barrier across
 * items); `only_if` stops the item when the previous output's field is not true. The finish stage waits for every
 * other step and runs when at least one item went through every stage.
 */
export function readiness(plan: WorkflowPlan, ref: StepRef, steps: ReadonlyMap<string, StepView>): Readiness {
  if (ref.finish) {
    const others = [...steps.values()].filter((s) => s.key !== FINISH);
    if (others.some((s) => !ENDED.has(s.state))) return { ready: false };
    const last = plan.stages.length - 1;
    const through = (plan.items?.length ? plan.items : [0]).some((_, i) => steps.get(keyOf(last, i))?.state === "done");
    return through ? { ready: true } : { ready: false, skip: "no item went through every stage" };
  }
  if (ref.stage === 0) return { ready: true };
  const prev = steps.get(keyOf(ref.stage - 1, ref.item));
  if (!prev || !ENDED.has(prev.state)) return { ready: false };
  if (prev.state !== "done") return { ready: false, skip: "an earlier stage of this item did not finish" };
  const field = plan.stages[ref.stage]?.only_if;
  if (field && !truthy(fieldOf(parsed(prev.output), field)))
    return { ready: false, skip: `the previous stage's ${field} was not true` };
  return { ready: true };
}

const truthy = (v: unknown) => v === true || v === "true" || v === "yes";

function parsed(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fieldOf(value: unknown, path: string): unknown {
  let v: unknown = value;
  for (const k of path.split(".")) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

const asText = (v: unknown): string => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** A short name for an item on the card: the item itself, or its name, title, id or first field. */
export function itemLabel(item: Item | undefined): string {
  if (item === undefined) return "";
  if (typeof item === "string") return item.replace(/\s+/g, " ").slice(0, 120);
  for (const k of ["name", "title", "label", "id", "key"]) if (typeof item[k] === "string") return String(item[k]);
  const first = Object.values(item)[0];
  return asText(first).replace(/\s+/g, " ").slice(0, 120);
}

/**
 * What one step's agent is told: the stage's task with its placeholders filled, the item, the previous stage's output
 * or every item's result when the task leaves them out, and the JSON it must end with.
 */
export function taskText(plan: WorkflowPlan, ref: StepRef, steps: ReadonlyMap<string, StepView>): string {
  const stage = stageOf(plan, ref);
  if (!stage) return "";
  const item = ref.finish ? undefined : plan.items?.[ref.item];
  const previous = ref.stage > 0 && !ref.finish ? steps.get(keyOf(ref.stage - 1, ref.item))?.output : undefined;
  const results = ref.finish ? resultsOf(plan, steps) : undefined;
  let text = stage.task
    .replace(/\{\{\s*item\.([\w.]+)\s*\}\}/g, (_, path: string) => asText(fieldOf(item, path)))
    .replace(/\{\{\s*item\s*\}\}/g, () => asText(item))
    .replace(/\{\{\s*previous\s*\}\}/g, () => (previous ?? "").slice(0, PREVIOUS_CHARS))
    .replace(/\{\{\s*results\s*\}\}/g, () => results ?? "");
  const extra: string[] = [];
  if (item !== undefined && !/\{\{\s*item/.test(stage.task)) extra.push(`Item:\n${asText(item)}`);
  if (previous !== undefined && !/\{\{\s*previous\s*\}\}/.test(stage.task))
    extra.push(`The previous stage's output:\n${previous.slice(0, PREVIOUS_CHARS)}`);
  if (results !== undefined && !/\{\{\s*results\s*\}\}/.test(stage.task))
    extra.push(`Every item's result:\n${results}`);
  if (extra.length) text = `${text}\n\n${extra.join("\n\n")}`;
  if (stage.output) text = `${text}\n\n${outputNote(stage.output)}`;
  return `This is one step of the workflow "${plan.name}" (phase ${stage.phase}). ${text}`;
}

const outputNote = (schema: JsonSchema) =>
  `End your answer with your result as JSON in a \`\`\`json block that fits this schema; that block is what the workflow passes on:\n${JSON.stringify(schema)}`;

/** Each item that went through every stage, with its last output (as JSON when it is). */
/** Each item's last output as text the owner reads on the card: a heading per item, fields as a list, never raw JSON. */
function resultsOf(plan: WorkflowPlan, steps: ReadonlyMap<string, StepView>): string {
  const last = plan.stages.length - 1;
  const items = plan.items?.length ? plan.items : [undefined];
  const blocks = items.flatMap((item, i) => {
    const step = steps.get(keyOf(last, i));
    if (step?.state !== "done") return [];
    const body = readable(parsed(step.output?.slice(0, RESULT_ITEM_CHARS)));
    return [items.length > 1 || item !== undefined ? `### ${labelOf(item, i)}\n\n${body}` : body];
  });
  return blocks.join("\n\n").slice(0, RESULTS_CHARS);
}

/** An item's name for its heading: itself when it is text, else its first name-like field. */
function labelOf(item: unknown, i: number): string {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const k of ["name", "title", "label", "area", "id"])
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
  }
  return `Item ${i + 1}`;
}

/** A value as Markdown: text as it is, an object's fields as a list, anything deeper as one line of JSON. */
function readable(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map((v) => `- ${line(v)}`).join("\n");
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => (typeof v === "string" && v.includes("\n") ? `**${k}:**\n\n${v}` : `- **${k}:** ${line(v)}`))
    .join("\n");
}

const line = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** The workflow's result: the finish stage's output, else each item's last output. */
export function resultOf(plan: WorkflowPlan, steps: ReadonlyMap<string, StepView>): string {
  if (plan.finish) {
    const f = steps.get(FINISH);
    if (f?.state === "done") return f.output ?? "";
  }
  return resultsOf(plan, steps);
}

/** The JSON an answer ends with: its last ```json block, else its last fenced block, else the answer itself. */
export function jsonOf(answer: string): { value: unknown } | { error: string } {
  const blocks = [...answer.matchAll(/```(json)?[^\n]*\n([\s\S]*?)```/g)];
  const tagged = blocks.filter((b) => b[1]);
  const candidates = [
    ...(tagged.length ? [tagged.at(-1)?.[2]] : []),
    ...(blocks.length ? [blocks.at(-1)?.[2]] : []),
    answer,
    braces(answer),
  ];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    try {
      return { value: JSON.parse(c) };
    } catch {}
  }
  return { error: "no JSON found in the answer" };
}

function braces(text: string): string | undefined {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return a >= 0 && b > a ? text.slice(a, b + 1) : undefined;
}

/** Where a value does not fit a JSON schema (types, properties, required, items, enum); empty when it fits. */
export function checkOutput(value: unknown, schema: JsonSchema, at = "$"): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((t) => typeFits(value, String(t))))
    return [`${at}: expected ${types.join(" or ")}, got ${kindOf(value)}`];
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${at}: must be one of ${JSON.stringify(schema.enum)}`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of Array.isArray(schema.required) ? schema.required : [])
      if (!(String(k) in obj)) errors.push(`${at}.${String(k)}: missing`);
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [k, sub] of Object.entries(props))
      if (k in obj && sub && typeof sub === "object") errors.push(...checkOutput(obj[k], sub, `${at}.${k}`));
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object")
    for (const [i, v] of value.entries()) errors.push(...checkOutput(v, schema.items as JsonSchema, `${at}[${i}]`));
  return errors.slice(0, 10);
}

function typeFits(v: unknown, t: string): boolean {
  if (t === "integer") return Number.isInteger(v);
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  if (t === "array") return Array.isArray(v);
  if (t === "null") return v === null;
  if (t === "object") return Boolean(v) && typeof v === "object" && !Array.isArray(v);
  return typeof v === t;
}

const kindOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** A step's answer checked against its stage's schema: the JSON text it passes on, or why it does not fit. */
export function outputOf(stage: Stage | undefined, answer: string): { output: string } | { error: string } {
  if (!stage?.output) return { output: answer };
  const found = jsonOf(answer);
  if ("error" in found) return found;
  const errors = checkOutput(found.value, stage.output);
  return errors.length ? { error: errors.join("; ") } : { output: JSON.stringify(found.value) };
}
