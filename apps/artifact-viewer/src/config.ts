type Environment = Record<string, string | boolean | undefined>;

export function viewerConfig(env: Environment) {
  const projectId = env.VITE_ARTIFACT_FIREBASE_PROJECT;
  const emulator = env.VITE_ARTIFACT_EMULATOR === "1";
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new Error(
      "Choose the artifact Firebase project explicitly. Run VITE_ARTIFACT_FIREBASE_PROJECT=<project-id> pnpm build. For local emulators, use VITE_ARTIFACT_FIREBASE_PROJECT=demo-apx-artifacts VITE_ARTIFACT_EMULATOR=1 pnpm build. This builds files only; it does not select a deployment target or deploy.",
    );
  if (emulator !== projectId.startsWith("demo-"))
    throw new Error("Demo projects require the emulator; real projects must not use it");
  return { projectId, emulator };
}
