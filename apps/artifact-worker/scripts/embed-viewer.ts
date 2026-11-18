import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const viewer = new URL("../../artifact-viewer/dist/", import.meta.url);
const generated = new URL("../.generated/", import.meta.url);
await rm(generated, { recursive: true, force: true });
await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("viewer-modules/", generated), { recursive: true });
const files = ["index.html", "runner.html"];
for (const name of (await readdir(new URL("assets/", viewer))).sort()) {
  if (/^[A-Za-z0-9_.-]+\.(js|css)$/.test(name)) files.push(`assets/${name}`);
}
const imports: string[] = [];
const entries: string[] = [];
for (const [index, name] of files.entries()) {
  const text = await readFile(new URL(name, viewer), "utf8");
  const module = `viewer-modules/${name.replaceAll("/", "_")}.txt`;
  await writeFile(new URL(module, generated), text);
  imports.push(`import file${index} from ${JSON.stringify(`./${module}`)};`);
  entries.push(`${JSON.stringify(`/${name}`)}: file${index}`);
}
await writeFile(
  new URL("index.ts", generated),
  `import { createWorker } from "../src/index.ts";\nexport { PublicationAccount, PublicationBudget } from "../src/index.ts";\n${imports.join("\n")}\nexport default createWorker({${entries.join(",\n")}});\n`,
);
console.log(`Embedded ${files.length} viewer text modules in ${fileURLToPath(generated)}`);
