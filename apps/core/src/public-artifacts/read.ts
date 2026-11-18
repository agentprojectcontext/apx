import { readPublicCopy } from "@apx/protocol/public-copy";

/** Anonymous server reads use a fixed service origin and never carry the owner's account token. */
export async function readPublishedArtifact(
  code: string,
  deps: { project: string; fetch?: typeof fetch; origin?: string },
) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(deps.project)) throw new Error("account_not_configured");
  const root = `${deps.origin ?? "https://firestore.googleapis.com"}/v1/projects/${deps.project}/databases/(default)/documents`;
  const signal = AbortSignal.timeout(20_000);
  const copy = await readPublicCopy(code, async (path) => {
    const response = await (deps.fetch ?? fetch)(`${root}/${path}`, { cache: "no-store", signal, redirect: "error" });
    if (!response.ok)
      throw new Error(
        response.status === 404 || response.status === 403 ? "public_artifact_missing" : "public_artifact_unavailable",
      );
    if (!response.body) throw new Error("public_artifact_unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 800_000) throw new Error("public_artifact_too_large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const doc = JSON.parse(text) as { fields?: Record<string, { stringValue?: string; integerValue?: string }> };
    return Object.fromEntries(
      Object.entries(doc.fields ?? {}).map(([key, value]) => [key, value.stringValue ?? Number(value.integerValue)]),
    );
  });
  return copy.bundle;
}
