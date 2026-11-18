import { isPublicArtifactCode, type publicArtifactCopy } from "../domain/public-artifact-copy.ts";
import type { CloudDocument } from "./firestore.ts";

type PublicArtifactCopy = ReturnType<typeof publicArtifactCopy>;

type Session = { uid: string; idToken: string; current?(): boolean };

export function createPublicArtifactCloud(deps: { origin?: string; fetch?: typeof fetch }) {
  const root = `${deps.origin ?? "https://artifact.apxagent.app"}/api/account/copies`;
  async function request(session: Session, path = "", copy?: PublicArtifactCopy, expected?: string) {
    if (session.current && !session.current()) throw new Error("public_artifact_account_changed");
    if (!session.uid || session.uid.includes("/") || !session.idToken) throw new Error("sign_in_required");
    const post = copy !== undefined || expected !== undefined;
    const response = await (deps.fetch ?? fetch)(`${root}${path}`, {
      method: post ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${session.idToken}`,
        "content-type": "application/vnd.apx.artifact+json",
        ...(expected ? { "x-artifact-revision": expected } : {}),
      },
      ...(copy ? { body: copy.json } : {}),
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      const known = new Set([
        "sign_in_required",
        "public_artifact_missing",
        "public_artifact_changed",
        "public_artifact_access_denied",
        "public_artifact_limit",
        "public_artifact_too_large",
        "public_artifact_rate_limited",
        "invalid_public_copy",
      ]);
      throw new Error(result.error && known.has(result.error) ? result.error : "public_artifact_unavailable");
    }
    return (await response.json()) as Record<string, unknown>;
  }
  const path = (code: string, action: string) => {
    if (!isPublicArtifactCode(code)) throw new Error("invalid_public_artifact_code");
    return `/${code}/${action}`;
  };
  async function write(
    session: Session,
    code: string,
    action: "publish" | "update",
    copy: PublicArtifactCopy,
    expected?: string,
  ) {
    try {
      const result = await request(session, path(code, action), copy, expected);
      if (result.code !== code || result.sha256 !== copy.sha256) throw new Error("public_artifact_unavailable");
    } catch (error) {
      let current: CloudDocument | undefined;
      try {
        current = (await request(session, path(code, "inspect"))) as CloudDocument;
      } catch {}
      if (current?.fields.sha256?.stringValue !== copy.sha256) throw error;
    }
    return { code, sha256: copy.sha256 };
  }
  return {
    async available(session: Session, code: string) {
      return (await request(session, path(code, "available"))).available === true;
    },
    async slots(session: Session) {
      const result = await request(session);
      if (!Array.isArray(result.documents) || result.documents.length > 20)
        throw new Error("public_artifact_unavailable");
      return result.documents as CloudDocument[];
    },
    async inspect(session: Session, code: string) {
      return (await request(session, path(code, "inspect"))) as CloudDocument;
    },
    publish(session: Session, code: string, copy: PublicArtifactCopy) {
      return write(session, code, "publish", copy);
    },
    update(session: Session, code: string, copy: PublicArtifactCopy, expected: string) {
      return write(session, code, "update", copy, expected);
    },
    async revoke(session: Session, code: string, expected: string) {
      try {
        const result = await request(session, path(code, "revoke"), undefined, expected);
        if (result.ok !== true) throw new Error("public_artifact_unavailable");
      } catch (error) {
        let revoked = false;
        try {
          await request(session, path(code, "inspect"));
        } catch (inspection) {
          revoked = inspection instanceof Error && inspection.message === "public_artifact_missing";
        }
        if (!revoked) throw error;
      }
      return { ok: true as const };
    },
  };
}
