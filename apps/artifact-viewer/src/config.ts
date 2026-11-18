type Environment = Record<string, string | boolean | undefined>;

export function viewerConfig(env: Environment) {
  const projectId = env.VITE_ARTIFACT_FIREBASE_PROJECT;
  const emulator = env.VITE_ARTIFACT_EMULATOR === "1";
  if (typeof projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId))
    throw new Error("Set VITE_ARTIFACT_FIREBASE_PROJECT explicitly before building the viewer");
  if (emulator !== projectId.startsWith("demo-"))
    throw new Error("Demo projects require the emulator; real projects must not use it");
  return { projectId, emulator };
}
