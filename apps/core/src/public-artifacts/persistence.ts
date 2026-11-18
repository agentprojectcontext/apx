import { createHash } from "node:crypto";
import { ArtifactBundle } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { draftBucket, PUBLIC_DRAFT_LIMIT, PUBLIC_DRAFT_SNAPSHOTS } from "./capacity.ts";
import type { PublicationDraftPersistence, PublicationDraftSnapshot } from "./drafts.ts";

const KEY = "public_artifact_drafts";
const StoredDraft = z
  .object({
    id: z.string().uuid(),
    uid: z.string().min(1).max(128),
    expires: z.number().int().positive(),
    action: z.enum(["publish", "update", "revoke"]),
    code: z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/),
    title: z.string().min(1).max(120),
    surface: z.string().optional(),
    keys: z.array(z.string().min(1).max(100)).max(1000),
    expected: z.string().optional(),
    copy: z
      .object({
        json: z.string(),
        bytes: z.number().int().min(1).max(4_200_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    done: z
      .object({ code: z.string(), url: z.string().url(), action: z.enum(["publish", "update", "revoke"]) })
      .optional(),
  })
  .strict();

const StoredDrafts = z
  .array(StoredDraft)
  .max(PUBLIC_DRAFT_SNAPSHOTS)
  .refine((drafts) =>
    ["copy", "revocation", "receipt"].every(
      (bucket) => drafts.filter((draft) => draftBucket(draft) === bucket).length <= PUBLIC_DRAFT_LIMIT,
    ),
  );

/** Local private snapshots, not cloud state or a public configuration setting. */
export function publicationDraftPersistence(settings: Store["settings"]): PublicationDraftPersistence {
  return {
    load() {
      const raw = settings.get(KEY);
      if (!raw) return [];
      try {
        const stored = StoredDrafts.parse(JSON.parse(raw));
        return stored.map((draft): PublicationDraftSnapshot => {
          if (!draft.copy) return { ...draft, copy: undefined };
          const { copy } = draft;
          if (
            Buffer.byteLength(copy.json, "utf8") !== copy.bytes ||
            createHash("sha256").update(copy.json).digest("hex") !== copy.sha256
          )
            throw new Error("Invalid local public-copy snapshot");
          return { ...draft, copy: { ...copy, bundle: ArtifactBundle.parse(JSON.parse(copy.json)) } };
        });
      } catch {
        return [];
      }
    },
    save(drafts) {
      // Keep only one serialized copy; session generations and human review tokens are deliberately absent.
      const stored = drafts.map(({ copy, ...draft }) => ({
        ...draft,
        ...(copy ? { copy: { json: copy.json, bytes: copy.bytes, sha256: copy.sha256 } } : {}),
      }));
      settings.set(KEY, JSON.stringify(StoredDrafts.parse(stored)));
    },
  };
}
