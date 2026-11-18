import type { Store } from "../domain/store.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { createPublicationDrafts } from "../public-artifacts/drafts.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

const CODES = new Set([
  "account_busy",
  "account_not_configured",
  "account_unavailable",
  "sign_in_required",
  "sign_in_cancelled",
  "public_artifact_missing",
  "public_artifact_changed",
  "public_artifact_limit",
  "public_artifact_preview_expired",
  "public_artifact_preview_limit",
  "public_artifact_source_missing",
  "public_artifact_pending",
  "public_artifact_source_changed",
  "public_artifact_account_changed",
  "public_artifact_access_denied",
  "public_artifact_too_large",
  "public_artifact_unavailable",
]);
const COPY_ERRORS: Readonly<Record<string, string>> = {
  "Choose at most 1000 different state keys": "public_artifact_state_changed",
  "This state key cannot be published": "public_artifact_state_changed",
  "A selected state key is no longer available": "public_artifact_state_changed",
  "Public artifacts can contain only JSON values": "public_artifact_invalid",
  "Remove secret references before publishing": "public_artifact_secret_reference",
  "This public copy is too large": "public_artifact_too_large",
  "Your public artifact limit has been reached": "public_artifact_limit",
};

async function result<T>(action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw badRequest(COPY_ERRORS[code] ?? (CODES.has(code) ? code : "public_artifact_unavailable"));
  }
}

export function publicArtifactHandlers(deps: {
  store: Store;
  publications: ReturnType<typeof createPublicationDrafts>;
}) {
  const scope = (ctx: CallContext) => {
    if (ctx.actor === "human" && !ctx.agent) return undefined;
    const thread = ctx.agent && deps.store.threads.get(ctx.agent.thread_id);
    if (!ctx.agent || !thread) throw unauthorized("public_artifact_access_denied");
    if (!thread.project_id && deps.store.agents.get(ctx.agent.id)?.kind === "secretary") return undefined;
    return { project: thread.project_id };
  };
  return {
    "surfaces.public_list": (_, ctx) => {
      if (scope(ctx)) throw unauthorized("public_artifact_access_denied");
      return result(() => deps.publications.list());
    },
    "surfaces.public_prepare": (params, ctx) => {
      const boundary = scope(ctx);
      if (boundary) {
        if (params.action !== "publish") throw unauthorized("public_artifact_access_denied");
        const source = deps.store.surfaces.get(params.surface);
        if (!source || (source.project_id && source.project_id !== boundary.project))
          throw notFound("public_artifact_missing");
      }
      return result(() => deps.publications.prepare(params));
    },
    "surfaces.public_preview": ({ draft }) => result(() => deps.publications.preview(draft)),
    "surfaces.public_commit": ({ draft }) => result(() => deps.publications.commit(draft)),
    "surfaces.public_discard": ({ draft }) => result(() => deps.publications.discard(draft)),
  } satisfies Partial<Handlers>;
}
