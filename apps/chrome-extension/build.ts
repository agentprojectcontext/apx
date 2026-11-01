import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { extensionBundle } from "./bundle.ts";

const { values } = parseArgs({ options: { port: { type: "string", default: "7440" } } });
const files = extensionBundle(Number(values.port));
const destination = path.join(import.meta.dirname, "dist");
for (const [name, content] of Object.entries(files)) {
  const file = path.join(destination, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
process.stdout.write(`Unpacked APX extension: ${destination}\n`);
