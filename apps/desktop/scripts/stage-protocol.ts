import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/** Compile every public subpath so installed consumers use the same contract as workspace consumers. */
export async function stageProtocol(source: string, out: string, version: string): Promise<void> {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")) as {
    name: string;
    exports: Record<string, string>;
  };
  const entryPoints: Record<string, string> = {};
  const exports: Record<string, string> = {};
  for (const [subpath, file] of Object.entries(manifest.exports)) {
    const name = subpath === "." ? "index" : subpath.slice(2);
    entryPoints[name] = path.join(source, file);
    exports[subpath] = `./${name}.js`;
  }
  await build({
    entryPoints,
    outdir: out,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node22",
    external: ["zod"],
    logLevel: "warning",
  });
  fs.writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ name: manifest.name, version, type: "module", exports }, null, 2),
  );
}
