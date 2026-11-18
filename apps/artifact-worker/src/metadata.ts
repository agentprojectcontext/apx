type Value = { stringValue?: string; integerValue?: string; timestampValue?: string };
export type Document = { name: string; fields: Record<string, Value>; updateTime: string };
export type Session = { uid: string; idToken: string };
const stringValue = (value: string) => ({ stringValue: value });
const field = (doc: Document, key: string) => doc.fields[key]?.stringValue ?? "";

export function metadataCloud(
  session: Session,
  deps: {
    project: string;
    origin?: string;
    fetch?: typeof fetch;
    after?: (ms: number, notify: () => void) => () => void;
  },
) {
  const documents = `projects/${deps.project}/databases/(default)/documents`;
  const root = `${deps.origin ?? "https://firestore.googleapis.com"}/v1/${documents}`;
  const slotsPath = `artifactAccounts/${encodeURIComponent(session.uid)}/slots`;
  async function request(path: string, writes?: unknown[]) {
    const controller = new AbortController();
    const after =
      deps.after ??
      ((ms, notify) => {
        const timer = setTimeout(notify, ms);
        return () => clearTimeout(timer);
      });
    const cancelDeadline = after(8_000, () => controller.abort());
    try {
      const response = await (deps.fetch ?? fetch)(`${root}${path}`, {
        method: writes ? "POST" : "GET",
        headers: { authorization: `Bearer ${session.idToken}`, "content-type": "application/json" },
        ...(writes ? { body: JSON.stringify({ writes }) } : {}),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? "public_artifact_missing"
            : [409, 412].includes(response.status)
              ? "public_artifact_changed"
              : [401, 403].includes(response.status)
                ? "public_artifact_access_denied"
                : "public_artifact_unavailable",
        );
      return (await response.json()) as { documents?: Document[]; nextPageToken?: string } & Document;
    } finally {
      cancelDeadline();
    }
  }
  const name = (path: string) => `${documents}/${path}`;
  return {
    async available(code: string) {
      try {
        await request(`/artifactOwners/${code}`);
        return false;
      } catch (error) {
        if (error instanceof Error && error.message === "public_artifact_missing") return true;
        if (error instanceof Error && error.message === "public_artifact_access_denied") return false;
        throw error;
      }
    },
    async slots() {
      const result = await request(`/${slotsPath}?pageSize=21`);
      if (result.nextPageToken || (result.documents?.length ?? 0) > 20) throw new Error("public_artifact_limit");
      return result.documents ?? [];
    },
    get(code: string) {
      return request(`/publicArtifacts/${code}`);
    },
    async reserve(code: string, meta: { title: string; bytes: number; sha256: string }) {
      const slots = await this.slots();
      const existing = slots.find((doc) => field(doc, "code") === code);
      const occupied = new Set(slots.map((doc) => doc.name.split("/").at(-1)));
      const slot =
        existing?.name.split("/").at(-1) ??
        Array.from({ length: 20 }, (_, i) => String(i)).find((id) => !occupied.has(id));
      if (slot === undefined) throw new Error("public_artifact_limit");
      let previous: Document | undefined;
      if (existing) previous = await this.get(code);
      await request(":commit", [
        ...(!existing
          ? [
              {
                update: { name: name(`${slotsPath}/${slot}`), fields: { code: stringValue(code) } },
                currentDocument: { exists: false },
              },
              {
                update: {
                  name: name(`artifactOwners/${code}`),
                  fields: { uid: stringValue(session.uid), slot: stringValue(slot) },
                },
                currentDocument: { exists: false },
              },
            ]
          : []),
        {
          update: {
            name: name(`publicArtifacts/${code}`),
            fields: {
              title: stringValue(meta.title),
              bytes: { integerValue: String(meta.bytes) },
              sha256: stringValue(meta.sha256),
            },
          },
          updateTransforms: [{ fieldPath: "updated_at", setToServerValue: "REQUEST_TIME" }],
          currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false },
        },
      ]);
      return slot;
    },
    async release(code: string, slot: string) {
      const optional = async (path: string) => {
        try {
          return await request(`/${path}`);
        } catch (error) {
          if (error instanceof Error && error.message === "public_artifact_missing") return undefined;
          throw error;
        }
      };
      const [publication, reservation] = await Promise.all([
        optional(`publicArtifacts/${code}`),
        optional(`${slotsPath}/${slot}`),
      ]);
      const writes: unknown[] = [];
      if (publication)
        writes.push({ delete: publication.name, currentDocument: { updateTime: publication.updateTime } });
      if (reservation && field(reservation, "code") === code)
        writes.push({ delete: reservation.name, currentDocument: { updateTime: reservation.updateTime } });
      if (writes.length) await request(":commit", writes);
    },
  };
}
