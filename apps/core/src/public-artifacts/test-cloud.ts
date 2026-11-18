import type { CloudDocument } from "./firestore.ts";

type Write = {
  update?: Pick<CloudDocument, "name" | "fields">;
  updateTransforms?: { fieldPath: string }[];
  delete?: string;
};

/** A recording transport, not a substitute for the separate Firestore security-rules suite. */
export function publicationTransport() {
  const documents = new Map<string, CloudDocument>();
  let commits = 0;
  let revision = 0;
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/documents:commit")) {
      const body = JSON.parse(String(init?.body)) as { writes: Write[] };
      commits++;
      for (const write of body.writes) {
        if (write.delete) documents.delete(write.delete);
        if (write.update) {
          const fields = { ...write.update.fields };
          for (const transform of write.updateTransforms ?? [])
            fields[transform.fieldPath] = { timestampValue: "2026-01-01T00:00:00.000Z" };
          documents.set(write.update.name, {
            ...write.update,
            fields,
            updateTime: `2026-01-01T00:00:00.${String(++revision).padStart(6, "0")}Z`,
          });
        }
      }
      return Response.json({});
    }
    const resource = url.pathname.slice("/v1/".length);
    if (url.searchParams.has("pageSize")) {
      const prefix = `${resource}/`;
      return Response.json({
        documents: [...documents.values()].filter(
          (doc) => doc.name.startsWith(prefix) && !doc.name.slice(prefix.length).includes("/"),
        ),
      });
    }
    const doc = documents.get(resource);
    return doc ? Response.json(doc) : Response.json({}, { status: 404 });
  };
  return { fetch: send, commits: () => commits, documents };
}
