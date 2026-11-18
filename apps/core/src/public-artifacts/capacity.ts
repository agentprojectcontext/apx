export const PUBLIC_DRAFT_LIMIT = 20;
export const PUBLIC_DRAFT_SNAPSHOTS = PUBLIC_DRAFT_LIMIT * 3;
type Entry = { action: string; done?: unknown; pending?: unknown };
export const draftBucket = (draft: Entry) =>
  draft.done ? "receipt" : draft.action === "revoke" ? "revocation" : "copy";

export function reserveDraftCapacity<T extends Entry>(
  drafts: Map<string, T>,
  action: string,
  protectedCard: (id: string) => boolean,
) {
  const bucket = action === "revoke" ? "revocation" : "copy";
  const entries = [...drafts].filter(([, draft]) => draftBucket(draft) === bucket);
  while (entries.length >= PUBLIC_DRAFT_LIMIT) {
    const index = entries.findIndex(([id, draft]) => !draft.pending && !protectedCard(id));
    if (index < 0) throw new Error("public_artifact_preview_limit");
    const [old] = entries.splice(index, 1);
    if (old) drafts.delete(old[0]);
  }
}

export function trimPublicationReceipts<T extends Entry>(drafts: Map<string, T>) {
  const receipts = [...drafts].filter(([, draft]) => draftBucket(draft) === "receipt");
  for (const [id] of receipts.slice(0, Math.max(0, receipts.length - PUBLIC_DRAFT_LIMIT))) drafts.delete(id);
}
