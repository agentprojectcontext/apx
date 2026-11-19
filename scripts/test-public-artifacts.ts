import { spawn } from "node:child_process";
import { startArtifactWorker } from "../apps/artifact-worker/src/testing.ts";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator) throw new Error("Run through pnpm test:firebase");
const worker = await startArtifactWorker({ emulator, port: 7497 });
try {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        "firebase/public-artifact*.browser.test.ts",
        "firebase/public-copies*.browser.test.ts",
        "firebase/public-copy-owner.browser.test.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          APX_ARTIFACT_VIEWER_URL: worker.origin,
          APX_ARTIFACT_TEST_IDENTITIES: JSON.stringify(worker.identities),
          APX_SECRETS: "file",
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  if (code) process.exitCode = code;
} finally {
  await worker.close();
}
