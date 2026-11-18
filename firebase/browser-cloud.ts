import { randomUUID } from "node:crypto";
import { publicationTransport } from "../apps/core/src/public-artifacts/test-cloud.ts";

/** Keep the same journey runnable against a recording transport or the real demo rules. */
export function browserCloud() {
  const uid = randomUUID();
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return { ...publicationTransport(), uid, token: "private-identity-token" };
  if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new Error("Use only the isolated Firestore emulator");
  const project = "demo-apx-artifacts";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: uid, user_id: uid, aud: project, iss: `https://securetoken.google.com/${project}`, iat: 1, exp: 4102444800, firebase: { sign_in_provider: "google.com", identities: {} } })}.`;
  let commits = 0;
  return {
    uid,
    token,
    commits: () => commits,
    fetch: (async (input, init) => {
      const original = new URL(String(input));
      if (original.origin !== "https://firestore.googleapis.com") throw new Error("Unexpected test origin");
      const response = await fetch(`http://${host}${original.pathname}${original.search}`, init);
      if (original.pathname.endsWith("/documents:commit") && response.ok) commits++;
      return response;
    }) as typeof fetch,
  };
}
