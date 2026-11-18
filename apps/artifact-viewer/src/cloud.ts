import { initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
} from "firebase/firestore";

const app = initializeApp({ projectId: import.meta.env.DEV ? "demo-apx-artifacts" : "apx-agents" });
const database = initializeFirestore(app, { localCache: memoryLocalCache() });
if (import.meta.env.DEV && import.meta.env.VITE_ARTIFACT_EMULATOR === "1") {
  connectFirestoreEmulator(database, "127.0.0.1", 8196);
}
export async function readDocument(path: string): Promise<unknown> {
  const result = await getDocFromServer(doc(database, path));
  if (!result.exists()) throw new Error("public_copy_unavailable");
  return result.data();
}
export function watchPublication(
  code: string,
  changed: (state: "waiting" | "live" | "missing") => void,
  failed: (missing: boolean) => void,
) {
  return onSnapshot(
    doc(database, `publicArtifacts/${code}`),
    { includeMetadataChanges: true },
    (snapshot) => changed(snapshot.metadata.fromCache ? "waiting" : snapshot.exists() ? "live" : "missing"),
    (error) => failed(error.code === "permission-denied" || error.code === "not-found"),
  );
}
