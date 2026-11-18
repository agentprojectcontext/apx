import { initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
} from "firebase/firestore";

import { viewerConfig } from "./config.ts";

const config = viewerConfig(import.meta.env);
const app = initializeApp({ projectId: config.projectId });
const database = initializeFirestore(app, { localCache: memoryLocalCache() });
if (config.emulator) {
  connectFirestoreEmulator(database, "127.0.0.1", 8196);
}
export async function readDocument(path: string): Promise<unknown> {
  const result = await getDocFromServer(doc(database, path));
  if (!result.exists()) throw new Error("public_copy_unavailable");
  return result.data();
}
export function watchPublication(
  code: string,
  changed: (state: "waiting" | "live" | "missing", metadata?: unknown) => void,
  failed: (missing: boolean) => void,
) {
  return onSnapshot(
    doc(database, `publicArtifacts/${code}`),
    { includeMetadataChanges: true },
    (snapshot) =>
      changed(
        snapshot.metadata.fromCache ? "waiting" : snapshot.exists() ? "live" : "missing",
        snapshot.metadata.fromCache ? undefined : snapshot.data(),
      ),
    (error) => failed(error.code === "permission-denied" || error.code === "not-found"),
  );
}
