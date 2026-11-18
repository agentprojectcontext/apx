import { isPublicArtifactCode } from "../domain/public-artifact-copy.ts";
import { artifactWrites, type PublicArtifactCopy } from "./writes.ts";

type Value = { stringValue?: string; integerValue?: string; timestampValue?: string };
export type CloudDocument = { name: string; fields: Record<string, Value>; updateTime: string };
type Session = { uid: string; idToken: string; current?(): boolean };
const string = (value: string): Value => ({ stringValue: value });
export const cloudString = (doc: CloudDocument, key: string): string => doc.fields[key]?.stringValue ?? "";
export const cloudNumber = (doc: CloudDocument, key: string): number => Number(doc.fields[key]?.integerValue ?? "NaN");

export function createPublicArtifactCloud(deps: { project: string; origin?: string; fetch?: typeof fetch }) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(deps.project)) throw new Error("account_not_configured");
  const documents = `projects/${deps.project}/databases/(default)/documents`;
  const root = `${deps.origin ?? "https://firestore.googleapis.com"}/v1/${documents}`;
  const send = deps.fetch ?? fetch;
  const resource = (path: string) => `${documents}/${path}`;
  const pathOf = (code: string) => {
    if (!isPublicArtifactCode(code)) throw new Error("invalid_public_artifact_code");
    return `publicArtifacts/${code}`;
  };
  const account = (session: Session) => {
    if (session.current && !session.current()) throw new Error("public_artifact_account_changed");
    if (!session.uid || session.uid.includes("/") || !session.idToken) throw new Error("sign_in_required");
    return `artifactAccounts/${encodeURIComponent(session.uid)}/slots`;
  };
  async function request(session: Session, path: string, body?: unknown): Promise<Record<string, unknown>> {
    account(session);
    const response = await send(`${root}${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${session.idToken}`, "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("public_artifact_missing");
      if ([409, 412].includes(response.status)) throw new Error("public_artifact_changed");
      if ([401, 403].includes(response.status)) throw new Error("public_artifact_access_denied");
      throw new Error("public_artifact_unavailable");
    }
    return (await response.json()) as Record<string, unknown>;
  }
  const get = async (session: Session, path: string) => (await request(session, `/${path}`)) as CloudDocument;
  async function owner(session: Session, code: string) {
    pathOf(code);
    const doc = await get(session, `artifactOwners/${code}`);
    if (cloudString(doc, "uid") !== session.uid) throw new Error("public_artifact_access_denied");
    return doc;
  }
  async function matches(session: Session, code: string, hash: string) {
    try {
      await owner(session, code);
      return cloudString(await get(session, pathOf(code)), "sha256") === hash;
    } catch {
      return false;
    }
  }
  const commit = (session: Session, writes: unknown[]) => request(session, ":commit", { writes });
  const remove = (path: string, updateTime?: string) => ({
    delete: resource(path),
    ...(updateTime ? { currentDocument: { updateTime } } : {}),
  });
  return {
    async slots(session: Session) {
      const result = await request(session, `/${account(session)}?pageSize=21`);
      const slots = (result.documents ?? []) as CloudDocument[];
      if (result.nextPageToken || slots.length > 20) throw new Error("public_artifact_limit");
      return slots;
    },
    async publish(session: Session, code: string, copy: PublicArtifactCopy) {
      pathOf(code);
      const slots = await this.slots(session);
      const occupied = new Set(slots.map((doc) => doc.name.split("/").at(-1)));
      const slot = Array.from({ length: 20 }, (_, i) => String(i)).find((id) => !occupied.has(id));
      if (slot === undefined) {
        if (await matches(session, code, copy.sha256)) return { code, sha256: copy.sha256 };
        throw new Error("public_artifact_limit");
      }
      try {
        await commit(session, [
          {
            update: { name: resource(`${account(session)}/${slot}`), fields: { code: string(code) } },
            currentDocument: { exists: false },
          },
          {
            update: {
              name: resource(`artifactOwners/${code}`),
              fields: { uid: string(session.uid), slot: string(slot) },
            },
            currentDocument: { exists: false },
          },
          ...artifactWrites(documents, code, copy),
        ]);
      } catch (error) {
        if (!(await matches(session, code, copy.sha256))) throw error;
      }
      return { code, sha256: copy.sha256 };
    },
    async inspect(session: Session, code: string) {
      await owner(session, code);
      return get(session, pathOf(code));
    },
    async update(session: Session, code: string, copy: PublicArtifactCopy, expected: string) {
      const previous = await this.inspect(session, code);
      if (cloudString(previous, "sha256") === copy.sha256) return { code, sha256: copy.sha256 };
      if (previous.updateTime !== expected) throw new Error("public_artifact_changed");
      try {
        await commit(session, artifactWrites(documents, code, copy, previous));
      } catch (error) {
        if (!(await matches(session, code, copy.sha256))) throw error;
      }
      return { code, sha256: copy.sha256 };
    },
    async revoke(session: Session, code: string, expected: string) {
      const ownership = await owner(session, code);
      let previous: CloudDocument;
      try {
        previous = await get(session, pathOf(code));
      } catch (error) {
        if (
          error instanceof Error &&
          ["public_artifact_missing", "public_artifact_access_denied"].includes(error.message)
        )
          return { ok: true as const };
        throw error;
      }
      if (previous.updateTime !== expected) throw new Error("public_artifact_changed");
      await commit(session, [
        remove(pathOf(code), expected),
        ...Array.from({ length: cloudNumber(previous, "chunk_count") }, (_, i) => remove(`${pathOf(code)}/parts/${i}`)),
        remove(`${account(session)}/${cloudString(ownership, "slot")}`),
      ]);
      return { ok: true as const };
    },
  };
}
