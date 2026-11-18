import { createHash } from "node:crypto";
import type { CloudDocument } from "./firestore.ts";

/** A recording edge transport, not a substitute for real Worker/R2 and emulator tests. */
export function publicationTransport() {
  const documents = new Map<string, CloudDocument>();
  const bodies = new Map<string, string>();
  const owners = new Map<string, string>();
  let commits = 0;
  let revision = 0;
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://artifact.apxagent.app") throw new Error("Unexpected public copy origin");
    const match = url.pathname.match(/^\/api\/(account\/)?copies(?:\/([0-9abcdefghjkmnpqrstvwxyz]{8})\/(\w+))?$/);
    if (!match) return Response.json({}, { status: 404 });
    const [, account, code = "", action = ""] = match;
    const uid = "person";
    const key = `publicArtifacts/${code}`;
    const previous = documents.get(key);
    if (!account) {
      if (!previous) return Response.json({}, { status: 404 });
      if (action === "bundle") return new Response(bodies.get(code));
      return Response.json({
        title: previous.fields.title?.stringValue,
        bytes: Number(previous.fields.bytes?.integerValue),
        sha256: previous.fields.sha256?.stringValue,
        revision: previous.updateTime,
      });
    }
    if (action === "available") return Response.json({ available: !owners.has(code) });
    if (!action)
      return Response.json({
        documents: [...documents.values()].filter((doc) => doc.name.startsWith(`artifactAccounts/${uid}/slots/`)),
      });
    if (action === "inspect")
      return Response.json(previous ?? { error: "public_artifact_missing" }, { status: previous ? 200 : 404 });
    if (init?.method !== "POST") return Response.json({}, { status: 405 });
    if (action === "revoke") {
      if (!previous) return Response.json({ error: "public_artifact_missing" }, { status: 404 });
      if (new Headers(init.headers).get("x-artifact-revision") !== previous.updateTime)
        return Response.json({ error: "public_artifact_changed" }, { status: 409 });
      documents.delete(key);
      bodies.delete(code);
      for (const [id, doc] of documents) if (doc.fields.code?.stringValue === code) documents.delete(id);
      commits++;
      return Response.json({ ok: true });
    }
    const json = String(init?.body);
    const bundle = JSON.parse(json) as { manifest: { title: string } };
    const sha256 = createHash("sha256").update(json).digest("hex");
    if (previous?.fields.sha256?.stringValue === sha256) return Response.json({ code, sha256 });
    if (action === "update" && new Headers(init?.headers).get("x-artifact-revision") !== previous?.updateTime)
      return Response.json({ error: "public_artifact_changed" }, { status: 409 });
    let slot = [...documents.values()].find((doc) => doc.fields.code?.stringValue === code)?.name;
    if (!slot) {
      const free = Array.from({ length: 20 }, (_, i) => `artifactAccounts/${uid}/slots/${i}`).find(
        (name) => !documents.has(name),
      );
      if (!free) return Response.json({ error: "public_artifact_limit" }, { status: 429 });
      slot = free;
    }
    const updateTime = `revision-${++revision}`;
    documents.set(key, {
      name: key,
      updateTime,
      fields: {
        title: { stringValue: bundle.manifest.title },
        bytes: { integerValue: String(Buffer.byteLength(json)) },
        sha256: { stringValue: sha256 },
        updated_at: { timestampValue: "2026-01-01T00:00:00.000Z" },
      },
    });
    documents.set(slot, { name: slot, updateTime, fields: { code: { stringValue: code } } });
    bodies.set(code, json);
    owners.set(code, uid);
    commits++;
    return Response.json({ code, sha256 });
  };
  return { fetch: send, commits: () => commits, documents };
}
