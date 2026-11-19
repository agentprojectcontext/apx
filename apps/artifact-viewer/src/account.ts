import { useCallback, useEffect, useState } from "react";

/** The Google sign-in the Worker announces in the page; absent when it was deployed without a web client. */
export type SignInConfig = { project: string; apiKey: string };
export type Person = { uid: string; email: string; name: string; photo?: string; token(): Promise<string> };

const HINT = "apx-signed-in";

export function signInConfig(doc: Document = document): SignInConfig | undefined {
  try {
    const value = JSON.parse(doc.querySelector('meta[name="apx-sign-in"]')?.getAttribute("content") ?? "null");
    return typeof value?.project === "string" && typeof value?.apiKey === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function hinted() {
  try {
    return localStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
}
function hint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT, "1");
    else localStorage.removeItem(HINT);
  } catch {}
}

type Firebase = {
  auth: import("firebase/auth").Auth;
  sdk: typeof import("firebase/auth");
};
let loading: Promise<Firebase> | undefined;

/** Firebase is only downloaded when someone may sign in: the menu opened, or a session was kept. */
function load(config: SignInConfig): Promise<Firebase> {
  loading ??= Promise.all([import("firebase/app"), import("firebase/auth")]).then(([app, sdk]) => {
    const instance = app.initializeApp({
      apiKey: config.apiKey,
      authDomain: `${config.project}.firebaseapp.com`,
      projectId: config.project,
    });
    return { auth: sdk.getAuth(instance), sdk };
  });
  return loading;
}

function person(user: import("firebase/auth").User): Person {
  return {
    uid: user.uid,
    email: user.email ?? "",
    name: user.displayName ?? user.email ?? "",
    photo: user.photoURL ?? undefined,
    token: () => user.getIdToken(),
  };
}

export function useAccount(config: SignInConfig | undefined) {
  const [current, setCurrent] = useState<Person>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!config || !hinted()) return;
    let off = () => {};
    let live = true;
    void load(config).then(({ auth, sdk }) => {
      if (!live) return;
      off = sdk.onAuthStateChanged(auth, (user) => {
        hint(Boolean(user));
        setCurrent(user ? person(user) : undefined);
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [config]);
  const prepare = useCallback(() => {
    if (config) void load(config);
  }, [config]);
  const signIn = useCallback(async () => {
    if (!config) return;
    setBusy(true);
    setFailed(false);
    try {
      const { auth, sdk } = await load(config);
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await sdk.signInWithPopup(auth, provider);
      hint(true);
      setCurrent(person(result.user));
    } catch (error) {
      // Closing Google's window is a choice, not a failure.
      const code = (error as { code?: string }).code ?? "";
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(code)) setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [config]);
  const signOut = useCallback(async () => {
    if (!config) return;
    const { auth, sdk } = await load(config);
    await sdk.signOut(auth);
    hint(false);
    setCurrent(undefined);
  }, [config]);
  return { person: current, busy, failed, prepare, signIn, signOut };
}

/** Whether the signed-in person published this copy, and the revision a change must name. */
export async function ownCopy(code: string, who: Person, send: typeof fetch = fetch) {
  const response = await send(`/api/account/copies/${code}/inspect`, {
    headers: { authorization: `Bearer ${await who.token()}` },
  });
  if (!response.ok) return undefined;
  const data = (await response.json()) as { updateTime?: unknown };
  return typeof data.updateTime === "string" ? { revision: data.updateTime } : undefined;
}

export async function stopSharing(code: string, who: Person, revision: string, send: typeof fetch = fetch) {
  const response = await send(`/api/account/copies/${code}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${await who.token()}`, "x-artifact-revision": revision },
  });
  if (!response.ok) throw new Error("stop_failed");
}
