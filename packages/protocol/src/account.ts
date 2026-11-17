import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

export const AccountProfile = z.object(
  schemaFields({
    id: () => z.string().regex(/^[0-9a-hjkmnp-tv-z]{8}$/),
    name: () => z.string().max(100),
    photo: () => z.string().max(2048),
    handle: () => z.string().max(24),
  }),
);
export type AccountProfile = z.infer<typeof AccountProfile>;

export const accountMethods = {
  "account.get": deferMethod({
    params: () => z.object({}).strict(),
    result: () => z.object({ available: z.boolean(), profile: AccountProfile.nullable() }),
    effect: false,
    access: "human",
  }),
  "account.start": deferMethod({
    params: () => z.object({ desktop: z.boolean().optional() }).strict(),
    result: () => z.object({ url: z.string() }),
    effect: true,
    access: "human",
    replay: false,
  }),
  "account.finish": deferMethod({
    params: () => z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(2000) }).strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
    open: true,
    replay: false,
  }),
  "account.rename": deferMethod({
    params: () => z.object({ handle: z.string().max(25) }).strict(),
    result: () => z.object({ profile: AccountProfile }),
    effect: true,
    access: "human",
    replay: false,
  }),
  "account.logout": deferMethod({
    params: () => z.object({}).strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
    replay: false,
  }),
} as const;
