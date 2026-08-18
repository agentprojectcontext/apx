import { clearRuntime, dropThrowaway, readRuntime } from "./throwaway";

// Unregisters the throwaway project and removes its temp dir. Best-effort:
// teardown failures must never mask test failures. The removal resolves the
// project by path, never by the recorded id — see throwaway.ts for why.
export default async function globalTeardown() {
  const rt = readRuntime();
  if (!rt) return;
  await dropThrowaway(rt);
  clearRuntime();
}
