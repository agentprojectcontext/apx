import { randomUUID } from "node:crypto";
import type { AccountProfile } from "@apx/protocol";
import { publicArtifactCode, publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { cloudNumber, cloudString, type createPublicArtifactCloud } from "./firestore.ts";

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
type Draft = {
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

export function createPublicationDrafts(deps: {
  account: PublicationAccount;
  cloud: Cloud;
  source(id: string): Source | undefined;
  decorateHtml(html: string): string;
  now?: () => number;
  code?: () => string;
  persistence?: PublicationDraftPersistence;
  pendingUntil?(id: string): number | undefined;
}) {
  const drafts = new Map<string, Draft>();
  const now = deps.now ?? Date.now;
  for (const saved of (deps.persistence?.load() ?? []).slice(-20)) {
    const draft = structuredClone(saved);
    draft.expires = Math.max(draft.expires, deps.pendingUntil?.(draft.id) ?? 0);
    if (draft.expires > now()) drafts.set(draft.id, draft);
  }
  const persist = () =>
    deps.persistence?.save(
      [...drafts.values()].map(({ pending: _pending, generation: _generation, reviewToken: _token, ...draft }) =>
        structuredClone(draft),
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
    async prepare(input: PublicationRequest) {
      return deps.account.withSession(async (session) => {
        current(session);
        if (!(["publish", "update", "revoke"] as const).includes(input.action))
          throw new Error("invalid_public_artifact_action");
        if ((input.action === "publish" && input.code) || (input.action !== "publish" && !input.code))
          throw new Error("invalid_public_artifact_target");
        if (input.action === "revoke" && (input.surface || input.state_keys?.length))
          throw new Error("invalid_public_artifact_target");
        if (input.action !== "revoke" && !input.surface) throw new Error("public_artifact_source_missing");
        const keys = [...(input.state_keys ?? [])];
        const copy = input.surface ? snapshot(input.surface, keys) : undefined;
        const remote = input.code ? await deps.cloud.inspect(session, input.code) : undefined;
        current(session);
        for (const [id, old] of drafts) {
          old.expires = Math.max(old.expires, deps.pendingUntil?.(id) ?? 0);
          if (
            !old.pending &&
            (old.expires <= now() ||
              (old.uid === session.uid &&
                old.surface === input.surface &&
                (input.action === "publish" || old.code === input.code) &&
                old.action === input.action))
          )
            drafts.delete(id);
        }
        if (drafts.size >= 20) throw new Error("public_artifact_preview_limit");
        let code = input.code;
        if (!code) {
          for (let attempt = 0; attempt < 8; attempt++) {
            const candidate = (deps.code ?? publicArtifactCode)();
            if (await deps.cloud.available(session, candidate)) {
              code = candidate;
              break;
            }
          }
          if (!code) throw new Error("public_artifact_code_unavailable");
        }
        current(session);
        if (drafts.size >= 20) throw new Error("public_artifact_preview_limit");
        const draft: Draft = {
          id: randomUUID(),
          uid: session.uid,
          generation: session.generation,
          expires: now() + 30 * 24 * 60 * 60_000,
          action: input.action,
          code,
          title: copy?.bundle.manifest.title ?? (remote ? cloudString(remote, "title") : ""),
          ...(input.surface ? { surface: input.surface } : {}),
          keys,
          ...(copy ? { copy } : {}),
          ...(remote ? { expected: remote.updateTime } : {}),
        };
        drafts.set(draft.id, draft);
        persist();
        return summary(draft);
      });
    },
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
        persist();
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
