import { readEdgePublicCopy } from "@apx/protocol/public-copy";

/** Anonymous installs never forward the owner's account token to the public reader. */
export async function readPublishedArtifact(code: string, deps: { fetch?: typeof fetch; origin?: string }) {
  return (await readEdgePublicCopy(code, { fetch: deps.fetch, origin: deps.origin })).bundle;
}
