import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export type AccountProfile = { id: string; name: string; photo: string; handle: string };

function accountId(): string {
  return [...randomBytes(8)].map((byte) => ALPHABET[byte & 31]).join("");
}

function accountHandle(value: string): string {
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  if (handle && !/^[a-z][a-z0-9_]{2,23}$/.test(handle)) throw new Error("invalid_handle");
  return handle;
}

/** Account writes use preconditions, so a collision never overwrites another person's reservation. */
export function createAccountProfiles(deps: { project: string; origin?: string; fetch?: typeof fetch }) {
  const fetchImpl = deps.fetch ?? fetch;
  const database = `projects/${deps.project}/databases/(default)`;
  const root = `${deps.origin ?? "https://firestore.googleapis.com"}/v1/${database}/documents`;
  const doc = (path: string) => `${database}/documents/${path}`;
  const fields = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }]));
  const request = async (token: string, url: string, body?: unknown) => {
    const response = await fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };
  const read = async (uid: string, token: string) => {
    const result = await request(token, `${root}/users/${encodeURIComponent(uid)}`);
    if (result.status === 404) return undefined;
    if (result.status !== 200) throw new Error("account_unavailable");
    const data = result.data as { fields: Record<string, { stringValue: string }>; updateTime: string };
    const value = (key: string) => data.fields[key]?.stringValue ?? "";
    return {
      profile: { id: value("id"), name: value("name"), photo: value("photo"), handle: value("handle") },
      revision: data.updateTime,
    };
  };
  return {
    async ensure(uid: string, token: string, name: string, photo: string): Promise<AccountProfile> {
      const existing = await read(uid, token);
      if (existing) return existing.profile;
      // A bounded retry handles short-id collisions and simultaneous first sign-ins on two devices.
      for (let attempt = 0; attempt < 5; attempt++) {
        const profile = { id: accountId(), name: name.slice(0, 100), photo: photo.slice(0, 2048), handle: "" };
        const result = await request(token, `${root}:commit`, {
          writes: [
            { update: { name: doc(`users/${uid}`), fields: fields(profile) }, currentDocument: { exists: false } },
            {
              update: { name: doc(`accountIds/${profile.id}`), fields: fields({ uid }) },
              currentDocument: { exists: false },
            },
          ],
        });
        if (result.status === 200) return profile;
        const concurrent = await read(uid, token);
        if (concurrent) return concurrent.profile;
        if (![403, 409].includes(result.status)) throw new Error("account_unavailable");
      }
      throw new Error("account_unavailable");
    },
    async rename(uid: string, token: string, value: string): Promise<AccountProfile> {
      const handle = accountHandle(value);
      const existing = await read(uid, token);
      if (!existing) throw new Error("account_unavailable");
      if (existing.profile.handle === handle) return existing.profile;
      const profile = { ...existing.profile, handle };
      const writes: unknown[] = [
        {
          update: { name: doc(`users/${uid}`), fields: fields(profile) },
          currentDocument: { updateTime: existing.revision },
        },
      ];
      if (handle)
        writes.push({
          update: { name: doc(`accountHandles/${handle}`), fields: fields({ uid }) },
          currentDocument: { exists: false },
        });
      if (existing.profile.handle)
        writes.push({ delete: doc(`accountHandles/${existing.profile.handle}`), currentDocument: { exists: true } });
      const result = await request(token, `${root}:commit`, { writes });
      if ([403, 409].includes(result.status)) throw new Error("handle_unavailable");
      if (result.status !== 200) throw new Error("account_unavailable");
      return profile;
    },
  };
}
