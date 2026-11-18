import { createHash } from "node:crypto";
import { ArtifactBundle } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { draftBucket, PUBLIC_DRAFT_LIMIT, PUBLIC_DRAFT_SNAPSHOTS } from "./capacity.ts";
import { publicationDraftFiles } from "./draft-files.ts";
import type { PublicationDraftPersistence, PublicationDraftSnapshot } from "./drafts.ts";

const KEY = "public_artifact_drafts";
const StoredDraft = z
  .object({
    id: z.string().uuid(),
    uid: z.string().min(1).max(128),
    expires: z.number().int().positive(),
    action: z.enum(["publish", "update", "revoke"]),
    code: z.string().regex(/^[0-9abcdefghjkmnpqrstvwxyz]{8}$/),
    title: z.string().max(120),
    surface: z.string().optional(),
    keys: z.array(z.string().min(1).max(100)).max(1000),
    expected: z.string().optional(),
    copy: z
      .object({
        bytes: z.number().int().min(1).max(4_200_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        json: z.string().max(4_200_000).optional(),
      })
      .strict()
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

/** The database holds only private metadata; immutable bytes live in private files under the injected home. */
export function publicationDraftPersistence(
  settings: Pick<Store["settings"], "get" | "set">,
  home: string,
): PublicationDraftPersistence {
  const files = publicationDraftFiles(home);
  const persistence: PublicationDraftPersistence = {
    load() {
      const raw = settings.get(KEY);
      if (!raw) return [];
      try {
        const stored = StoredDrafts.parse(JSON.parse(raw));
        const snapshots = stored.flatMap((draft): PublicationDraftSnapshot[] => {
          if (!draft.copy || draft.done) return [{ ...draft, copy: undefined }];
          try {
            const json = draft.copy.json ?? files.read(draft.id, draft.copy);
            if (
              Buffer.byteLength(json, "utf8") !== draft.copy.bytes ||
              createHash("sha256").update(json).digest("hex") !== draft.copy.sha256
            )
              return [];
            return [{ ...draft, copy: { ...draft.copy, json, bundle: ArtifactBundle.parse(JSON.parse(json)) } }];
          } catch {
            return [];
          }
        });
        if (stored.some((draft) => draft.copy?.json !== undefined) && snapshots.length === stored.length) {
          // Move inline snapshots once, preserving the old row if staging files or committing metadata fails.
          try {
            persistence.save(snapshots);
          } catch {}
        }
        return snapshots;
      } catch {
        return [];
      }
    },
    save(drafts) {
      const stored = StoredDrafts.parse(
        drafts.map(({ copy, ...draft }) => ({
          ...draft,
          ...(copy ? { copy: { bytes: copy.bytes, sha256: copy.sha256 } } : {}),
        })),
      );
      const created: PublicationDraftSnapshot[] = [];
      try {
        for (const draft of drafts) if (draft.copy && files.write(draft.id, draft.copy)) created.push(draft);
        settings.set(KEY, JSON.stringify(stored));
      } catch (error) {
        files.rollback(created);
        throw error;
      }
      // Old files are removed only after the metadata commit; a failed commit leaves the prior snapshots intact.
      files.prune(stored);
    },
  };
  return persistence;
}
