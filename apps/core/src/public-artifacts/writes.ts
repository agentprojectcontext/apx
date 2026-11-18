import type { CloudDocument } from "./firestore.ts";

export type PublicArtifactCopy = {
  json: string;
  bytes: number;
  sha256: string;
  bundle: { manifest: { title: string } };
};
const CHUNK_CHARS = 700_000;
const CHUNKS = 8;

function chunksOf(json: string): string[] {
  const base64 = Buffer.from(json, "utf8").toString("base64");
  if (!base64.length || base64.length > CHUNK_CHARS * CHUNKS) throw new Error("public_artifact_too_large");
  return Array.from({ length: Math.ceil(base64.length / CHUNK_CHARS) }, (_, i) =>
    base64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
  );
}

export function artifactWrites(documents: string, code: string, copy: PublicArtifactCopy, previous?: CloudDocument) {
  const path = `${documents}/publicArtifacts/${code}`;
  const chunks = chunksOf(copy.json);
  const writes: unknown[] = [
    {
      update: {
        name: path,
        fields: {
          title: { stringValue: copy.bundle.manifest.title },
          chunk_count: { integerValue: String(chunks.length) },
          bytes: { integerValue: String(copy.bytes) },
          sha256: { stringValue: copy.sha256 },
        },
      },
      updateTransforms: [{ fieldPath: "updated_at", setToServerValue: "REQUEST_TIME" }],
      currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false },
    },
    ...chunks.map((data, index) => ({
      update: { name: `${path}/parts/${index}`, fields: { data: { stringValue: data } } },
    })),
  ];
  for (let i = chunks.length; i < Number(previous?.fields.chunk_count?.integerValue ?? 0); i++) {
    writes.push({ delete: `${path}/parts/${i}` });
  }
  return writes;
}
