import { z } from "zod";

const Gid = z.string().regex(/^\d+$/).max(40);
const Page = { limit: z.number().int().min(1).max(100).default(50), offset: z.string().max(1000).optional() };
export const AsanaRead = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("workspaces"), ...Page }).strict(),
  z.object({ operation: z.literal("projects"), workspace: Gid, ...Page }).strict(),
  z.object({ operation: z.literal("tasks"), project: Gid, ...Page }).strict(),
  z.object({ operation: z.literal("task"), task: Gid }).strict(),
]);
const Fields = {
  name: z.string().min(1).max(1000).optional(),
  notes: z.string().max(20000).optional(),
  completed: z.boolean().optional(),
  due_on: z.iso.date().nullable().optional(),
  assignee: z.union([Gid, z.literal("me"), z.null()]).optional(),
};
export const AsanaWrite = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create_task"), project: Gid, ...Fields, name: Fields.name.unwrap() }).strict(),
  z
    .object({ operation: z.literal("update_task"), task: Gid, ...Fields })
    .strict()
    .refine(
      (value) =>
        Object.entries(value).some(([key, field]) => key !== "operation" && key !== "task" && field !== undefined),
      "at least one task field is required",
    ),
]);
const Result = z.object({ data: z.unknown(), next_offset: z.string().optional() });
export const asanaMethods = {
  "asana.read": {
    params: z.object({ project: z.string().optional(), request: AsanaRead }).strict(),
    result: Result,
    effect: false,
  },
  "asana.write": {
    params: z.object({ project: z.string().optional(), request: AsanaWrite }).strict(),
    result: Result,
    effect: true,
    access: "human",
  },
} as const;
