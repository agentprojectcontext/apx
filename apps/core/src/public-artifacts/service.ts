import type { Account } from "../account/session.ts";
import { publicInput } from "../domain/inputs.ts";
import type { Store } from "../domain/store.ts";
import { withKit } from "../surface-kit.ts";
import { createPublicArtifactCloud } from "./cloud.ts";
import { createPublicationDrafts } from "./drafts.ts";
import { publicationDraftPersistence, publicationSources } from "./persistence.ts";
import { readPublishedArtifact } from "./read.ts";

export function createPublicationService(deps: {
  account: Account;
  store: Store;
  home: string;
  onReceiptPersistenceError?(): void;
  fetch?: typeof fetch | undefined;
}) {
  const drafts = createPublicationDrafts({
    account: deps.account,
    cloud: createPublicArtifactCloud({ fetch: deps.fetch }),
    source: (id) => deps.store.surfaces.get(id),
    decorateHtml: (html) => withKit(html),
    persistence: publicationDraftPersistence(deps.store.settings, deps.home),
    onReceiptPersistenceError: deps.onReceiptPersistenceError,
    sources: publicationSources(deps.store.settings),
    pendingUntil: (id) => {
      const deadlines = deps.store.inputs
        .pending()
        .filter((record) => publicInput(record).artifact_draft === id)
        .map((record) => Date.parse(record.expires_at));
      return deadlines.length ? Math.max(...deadlines) : undefined;
    },
  });
  return {
    ...drafts,
    read: (code: string) => readPublishedArtifact(code, { fetch: deps.fetch }),
  };
}
