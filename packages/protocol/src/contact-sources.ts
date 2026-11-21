import { z } from "zod";
import { deferMethod } from "./defer-method.ts";

export const ContactSource = z.object({
  id: z.string(),
  person: z.string(),
  agent: z.string(),
  project: z.string(),
  label: z.string(),
  path: z.string(),
  revision: z.string(),
  allow_updates: z.boolean().default(false),
});
export const ContactSourceUpdate = z.object({
  id: z.string(),
  source: z.string(),
  person: z.string(),
  channel: z.string(),
  thread: z.string(),
  run: z.string(),
  message: z.string().optional(),
  revision: z.string(),
  result_revision: z.string().optional(),
  old: z.string(),
  replacement: z.string(),
  state: z.enum(["pending", "applying", "accepted", "rejected"]),
  created_at: z.string(),
});

export const contactSourceMethods = {
  "contacts.sources.list": deferMethod({
    params: () => z.object({ person: z.string() }).strict(),
    result: () => z.object({ sources: z.array(ContactSource) }),
    effect: false,
    access: "human",
  }),
  "contacts.sources.set": deferMethod({
    params: () =>
      z
        .object({
          person: z.string(),
          project: z.string(),
          agent: z.string(),
          path: z.string().min(1).max(1000),
          label: z.string().trim().min(1).max(100),
          allow_updates: z.boolean().default(false),
        })
        .strict(),
    result: () => ContactSource,
    effect: true,
    access: "human",
  }),
  "contacts.sources.remove": deferMethod({
    params: () => z.object({ id: z.string() }).strict(),
    result: () => z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  }),
  "contacts.source_updates.list": deferMethod({
    params: () => z.object({ person: z.string().optional() }).strict(),
    result: () => z.object({ updates: z.array(ContactSourceUpdate) }),
    effect: false,
    access: "human",
  }),
  "contacts.source_updates.resolve": deferMethod({
    params: () => z.object({ id: z.string(), accept: z.boolean() }).strict(),
    result: () => ContactSourceUpdate,
    effect: true,
    access: "human",
  }),
} as const;
