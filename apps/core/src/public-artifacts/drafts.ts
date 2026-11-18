import { randomUUID } from "node:crypto";
import type { AccountProfile } from "@apx/protocol";
import { publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { PUBLIC_DRAFT_SNAPSHOTS, trimPublicationReceipts } from "./capacity.ts";
import type { createPublicArtifactCloud } from "./cloud.ts";
import { cloudNumber, cloudString } from "./firestore.ts";
import { preparePublication } from "./prepare.ts";

type Source = Parameters<typeof publicArtifactCopy>[0];
type Cloud = ReturnType<typeof createPublicArtifactCloud>;
export type PublicationSession = {
  uid: string;
  idToken: string;
  profile?: AccountProfile;
  generation: number;
  current(): boolean;
};
export type PublicationAccount = { withSession<T>(work: (session: PublicationSession) => Promise<T>): Promise<T> };
export type PublicationRequest = {
  action: "publish" | "update" | "revoke";
  surface?: string;
  code?: string;
  state_keys?: string[];
};
type Receipt = { code: string; url: string; action: PublicationRequest["action"] };
export type Draft = {
  id: string;
  uid: string;
  generation?: number;
  reviewToken?: string;
  expires: number;
  action: PublicationRequest["action"];
  code: string;
  title: string;
  surface?: string;
  keys: string[];
  expected?: string;
  copy?: ReturnType<typeof publicArtifactCopy>;
  done?: Receipt;
  pending?: Promise<Receipt>;
};
export type PublicationDraftSnapshot = Omit<Draft, "pending" | "generation" | "reviewToken">;
export type PublicationDraftPersistence = {
  load(): readonly PublicationDraftSnapshot[];
  save(drafts: readonly PublicationDraftSnapshot[]): void;
};
const address = (code: string) => `https://artifact.apxagent.app/${code}`;
const summary = (draft: Draft) => ({
  draft: draft.id,
  action: draft.action,
  code: draft.code,
  url: address(draft.code),
  title: draft.title,
  bytes: draft.copy?.bytes ?? 0,
  state_keys: [...draft.keys],
  expires_at: new Date(draft.expires).toISOString(),
});

export type PublicationDraftDependencies = {
  account: PublicationAccount;
  cloud: Cloud;
  source(id: string): Source | undefined;
  decorateHtml(html: string): string;
  now?: () => number;
  code?: () => string;
  persistence?: PublicationDraftPersistence;
  pendingUntil?(id: string): number | undefined;
  onReceiptPersistenceError?(): void;
};

export function createPublicationDrafts(deps: PublicationDraftDependencies) {
  const drafts = new Map<string, Draft>();
  const now = deps.now ?? Date.now;
  for (const saved of (deps.persistence?.load() ?? []).slice(-PUBLIC_DRAFT_SNAPSHOTS)) {
    const draft = structuredClone(saved);
    if (draft.done) delete draft.copy;
    draft.expires = Math.max(draft.expires, deps.pendingUntil?.(draft.id) ?? 0);
    if (draft.expires > now()) drafts.set(draft.id, draft);
  }
  const persist = () =>
    deps.persistence?.save(
      [...drafts.values()].map(
        ({ pending: _pending, generation: _generation, reviewToken: _token, ...draft }) => draft,
      ),
    );
  const snapshot = (id: string, keys: string[]) => {
    const source = deps.source(id);
    if (!source) throw new Error("public_artifact_source_missing");
    return publicArtifactCopy({ ...source, html: deps.decorateHtml(source.html) }, keys);
  };
  const current = (session: PublicationSession, draft?: Draft) => {
    if (!session.current() || (draft && (draft.uid !== session.uid || draft.generation !== session.generation)))
      throw new Error("public_artifact_account_changed");
  };
  const find = (id: string) => {
    for (const [key, draft] of drafts) {
      draft.expires = Math.max(draft.expires, deps.pendingUntil?.(draft.id) ?? 0);
      if (draft.expires <= now() && !draft.pending) drafts.delete(key);
    }
    const draft = drafts.get(id);
    if (!draft || draft.expires <= now()) throw new Error("public_artifact_preview_expired");
    return draft;
  };
  const execute = (draft: Draft) =>
    deps.account.withSession(async (session): Promise<Receipt> => {
      if (draft.generation === undefined) throw new Error("public_artifact_review_required");
      current(session, draft);
      if (draft.copy && draft.surface && snapshot(draft.surface, draft.keys).sha256 !== draft.copy.sha256)
        throw new Error("public_artifact_source_changed");
      if (draft.action === "publish" && draft.copy) await deps.cloud.publish(session, draft.code, draft.copy);
      else if (draft.action === "update" && draft.copy && draft.expected)
        await deps.cloud.update(session, draft.code, draft.copy, draft.expected);
      else if (draft.action === "revoke" && draft.expected)
        await deps.cloud.revoke(session, draft.code, draft.expected);
      else throw new Error("public_artifact_preview_expired");
      current(session, draft);
      return { code: draft.code, url: address(draft.code), action: draft.action };
    });
  return {
    describe(id: string) {
      return summary(find(id));
    },
    async discard(id: string) {
      const draft = drafts.get(id);
      if (!draft) return { ok: true as const };
      return deps.account.withSession(async (session) => {
        current(session, draft);
        if (draft.pending) throw new Error("public_artifact_pending");
        drafts.delete(id);
        persist();
        return { ok: true as const };
      });
    },
    prepare: preparePublication({ deps, drafts, now, snapshot, current, persist, summary }),
    async verifyReview(id: string, token: string): Promise<boolean> {
      try {
        const draft = find(id);
        if (!token || draft.reviewToken !== token) return false;
        return await deps.account.withSession(async (session) => {
          current(session, draft);
          if (draft.copy && draft.surface && snapshot(draft.surface, draft.keys).sha256 !== draft.copy.sha256)
            return false;
          return true;
        });
      } catch {
        return false;
      }
    },
    async preview(id: string) {
      const draft = find(id);
      return deps.account.withSession(async (session) => {
        if (draft.generation === undefined) {
          current(session);
          if (session.uid !== draft.uid) throw new Error("public_artifact_account_changed");
          draft.generation = session.generation;
        }
        current(session, draft);
        if (draft.copy && draft.surface && snapshot(draft.surface, draft.keys).sha256 !== draft.copy.sha256)
          throw new Error("public_artifact_source_changed");
        draft.reviewToken ??= randomUUID();
        return {
          ...summary(draft),
          review_token: draft.reviewToken,
          ...(session.profile ? { account: { ...session.profile } } : {}),
          ...(draft.copy ? { bundle: JSON.parse(draft.copy.json) as typeof draft.copy.bundle } : {}),
        };
      });
    },
    async commit(id: string) {
      const draft = find(id);
      if (draft.done)
        return deps.account.withSession(async (session) => {
          current(session, draft);
          return { ...draft.done } as Receipt;
        });
      if (draft.pending) return draft.pending;
      draft.pending = execute(draft);
      try {
        draft.done = await draft.pending;
        delete draft.copy;
        drafts.delete(draft.id);
        drafts.set(draft.id, draft);
        trimPublicationReceipts(drafts);
        try {
          persist();
        } catch {
          // A local receipt failure cannot undo the confirmed remote action.
          try {
            deps.onReceiptPersistenceError?.();
          } catch {}
        }
        return { ...draft.done };
      } finally {
        delete draft.pending;
      }
    },
    async list() {
      return deps.account.withSession(async (session) => {
        current(session);
        const slots = await deps.cloud.slots(session);
        const items = await Promise.all(
          slots.map(async (slot) => {
            const code = cloudString(slot, "code");
            const item = await deps.cloud.inspect(session, code);
            return {
              code,
              url: address(code),
              title: cloudString(item, "title"),
              bytes: cloudNumber(item, "bytes"),
              updated_at: item.fields.updated_at?.timestampValue ?? "",
            };
          }),
        );
        current(session);
        return { items, count: items.length, bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
      });
    },
  };
}
