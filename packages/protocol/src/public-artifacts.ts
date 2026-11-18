import { z } from "zod";
import { AccountProfile } from "./account.ts";
import { deferMethod } from "./defer-method.ts";
import { ArtifactBundle, Id } from "./domain.ts";
import { schemaFields } from "./schema-fields.ts";

const Code = z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
const Keys = z.array(z.string().min(1).max(100)).max(1000);
const DraftId = z.string().uuid();
const Receipt = z.object(
  schemaFields({
    code: () => Code,
    url: () => z.string().url().max(256),
    action: () => z.enum(["publish", "update", "revoke"]),
  }),
);
const Draft = Receipt.extend(
  schemaFields({
    draft: () => DraftId,
    title: () => z.string().min(1).max(120),
    bytes: () => z.number().int().min(0).max(4_200_000),
    state_keys: () => Keys,
    expires_at: () => z.string().datetime(),
  }),
);

export const publicArtifactMethods = {
  "surfaces.public_read": deferMethod({
    params: () => z.object({ code: Code }).strict(),
    result: () => ArtifactBundle,
    effect: false,
    access: "human",
  }),
  "surfaces.public_list": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        items: z
          .array(
            z.object({
              code: Code,
              url: z.string().url().max(256),
              title: z.string().min(1).max(120),
              bytes: z.number().int().min(1).max(4_200_000),
              updated_at: z.string().datetime(),
            }),
          )
          .max(20),
        count: z.number().int().min(0).max(20),
        bytes: z.number().int().min(0).max(84_000_000),
      }),
    effect: false,
  }),
  "surfaces.public_prepare": deferMethod({
    params: () =>
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("publish"), surface: Id, state_keys: Keys.optional() }).strict(),
        z.object({ action: z.literal("update"), surface: Id, code: Code, state_keys: Keys.optional() }).strict(),
        z.object({ action: z.literal("revoke"), code: Code }).strict(),
      ]),
    result: () => Draft,
    effect: true,
  }),
  "surfaces.public_preview": deferMethod({
    params: () => z.object({ draft: DraftId }).strict(),
    result: () =>
      Draft.extend({
        bundle: ArtifactBundle.optional(),
        account: AccountProfile.optional(),
        review_token: z.string().uuid(),
      }),
    effect: false,
    access: "human",
  }),
  "surfaces.public_commit": deferMethod({
    params: () => z.object({ draft: DraftId }).strict(),
    result: () => Receipt,
    effect: true,
    access: "human",
  }),
  "surfaces.public_discard": deferMethod({
    params: () => z.object({ draft: DraftId }).strict(),
    result: () => z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  }),
} as const;
