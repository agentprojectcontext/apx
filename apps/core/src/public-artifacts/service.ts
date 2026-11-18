import type { Account } from "../account/session.ts";
import type { Store } from "../domain/store.ts";
import { withKit } from "../surface-kit.ts";
import { createPublicationDrafts } from "./drafts.ts";
import { createPublicArtifactCloud } from "./firestore.ts";
import { readPublishedArtifact } from "./read.ts";

export function createPublicationService(deps: {
  account: Account;
  store: Store;
  project: string | undefined;
  fetch?: typeof fetch | undefined;
}) {
  const drafts = createPublicationDrafts({
    account: deps.account,
    cloud: createPublicArtifactCloud({ project: deps.project ?? "apx-agents", fetch: deps.fetch }),
    source: (id) => deps.store.surfaces.get(id),
    decorateHtml: (html) => withKit(html),
  });
  return {
    ...drafts,
    read: (code: string) => readPublishedArtifact(code, { project: deps.project ?? "apx-agents", fetch: deps.fetch }),
  };
}
