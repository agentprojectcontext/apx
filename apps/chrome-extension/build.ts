import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { extensionBundle } from "./bundle.ts";
import { writeZip } from "./zip.ts";

const { values } = parseArgs({
  options: { port: { type: "string", default: "7440" }, store: { type: "boolean", default: false } },
});
if (values.store) {
  const files = extensionBundle(Number(values.port), { store: true });
  const { version } = JSON.parse(files["manifest.json"]) as { version: string };
  const destination = path.join(import.meta.dirname, "..", "..", "out", `apx-chrome-extension-${version}.zip`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, writeZip(files));
  process.stdout.write(`Chrome Web Store upload: ${destination}\n`);
} else {
  const files = extensionBundle(Number(values.port));
  const destination = path.join(import.meta.dirname, "dist");
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(destination, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  process.stdout.write(`Unpacked APX extension: ${destination}\n`);
}
