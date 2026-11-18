import { randomUUID } from "node:crypto";
import { publicArtifactCode, type publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import { reserveDraftCapacity } from "./capacity.ts";
import type { Draft, PublicationDraftDependencies, PublicationRequest, PublicationSession } from "./drafts.ts";
import { cloudString } from "./firestore.ts";

export function preparePublication<Summary>(state: {
  deps: PublicationDraftDependencies;
  drafts: Map<string, Draft>;
  now(): number;
  snapshot(id: string, keys: string[]): ReturnType<typeof publicArtifactCopy>;
  current(session: PublicationSession, draft?: Draft): void;
  persist(): void;
  summary(draft: Draft): Summary;
}) {
  const { deps, drafts, now, snapshot, current, persist, summary } = state;
  const protectedCard = (id: string) => (deps.pendingUntil?.(id) ?? 0) > now();
  return async (input: PublicationRequest) =>
    deps.account.withSession(async (session) => {
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
          !protectedCard(id) &&
          (old.expires <= now() ||
            (!old.done &&
              old.uid === session.uid &&
              old.surface === input.surface &&
              (input.action === "publish" || old.code === input.code) &&
              old.action === input.action))
        )
          drafts.delete(id);
      }
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
      reserveDraftCapacity(drafts, input.action, protectedCard);
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
}
