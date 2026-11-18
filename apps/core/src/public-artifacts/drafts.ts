import { randomUUID } from "node:crypto";
import { publicArtifactCode, publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { cloudNumber, cloudString, type createPublicArtifactCloud } from "./firestore.ts";

type Source = Parameters<typeof publicArtifactCopy>[0];
type Cloud = ReturnType<typeof createPublicArtifactCloud>;
export type PublicationSession = { uid: string; idToken: string; generation: number; current(): boolean };
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
  generation: number;
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
}) {
  const drafts = new Map<string, Draft>();
  const now = deps.now ?? Date.now;
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
    for (const [key, draft] of drafts) if (draft.expires <= now() && !draft.pending) drafts.delete(key);
    const draft = drafts.get(id);
    if (!draft || draft.expires <= now()) throw new Error("public_artifact_preview_expired");
    return draft;
  };
  const execute = (draft: Draft) =>
    deps.account.withSession(async (session): Promise<Receipt> => {
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
        const draft: Draft = {
          id: randomUUID(),
          uid: session.uid,
          generation: session.generation,
          expires: now() + 10 * 60_000,
          action: input.action,
          code: input.code ?? publicArtifactCode(),
          title: copy?.bundle.manifest.title ?? (remote ? cloudString(remote, "title") : ""),
          ...(input.surface ? { surface: input.surface } : {}),
          keys,
          ...(copy ? { copy } : {}),
          ...(remote ? { expected: remote.updateTime } : {}),
        };
        drafts.set(draft.id, draft);
        return summary(draft);
      });
    },
    async preview(id: string) {
      const draft = find(id);
      return deps.account.withSession(async (session) => {
        current(session, draft);
        return {
          ...summary(draft),
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
