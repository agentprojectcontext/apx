// apx artifacts: list them, show a built page as one (push), where a built artifact keeps its source (dir), and move
// one between APX installs as an .apxart file (export, import).
import fs from "node:fs";
import path from "node:path";
import { ARTIFACT_FILE_EXT, type ArtifactBundle } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";
import { apxHome } from "./local.ts";

const NAME = /^[a-z0-9][a-z0-9-]{0,59}$/;
const USAGE = `usage:
  apx artifacts list [--project <id>] [--json]
  apx artifacts push <name> <file.html> [--title <title>] [--app] [--connect <origin,…>] [--project <id>]
  apx artifacts dir <name> [--project <id>]
  apx artifacts export <name> [--memory] [--out <file>] [--project <id>]
  apx artifacts import <file.apxart> [--project <id>]`;

export type ArtifactOpts = {
  project?: string | undefined;
  title?: string | undefined;
  app?: boolean | undefined;
  connect?: string | undefined;
  json?: boolean | undefined;
  /** export: with what it remembers (state, store, database). */
  memory?: boolean | undefined;
  out?: string | undefined;
};

function named(name: string | undefined): string {
  if (!name || !NAME.test(name)) throw new Error(`an artifact name is kebab-case (monthly-sales)\n${USAGE}`);
  return name;
}

/** Where a built artifact's source lives: beside its memory in APX's home, never in the owner's project. */
export function artifactSourceDir(home: string, name: string, project?: string): string {
  const scope = project ?? "global";
  if (!/^[A-Za-z0-9_-]+$/.test(scope)) throw new Error(`not a project id: ${scope}`);
  return path.join(home, "artifact-sources", scope, named(name));
}

export async function artifacts(client: ApxClient, [sub, ...rest]: string[], opts: ArtifactOpts): Promise<void> {
  switch (sub ?? "list") {
    case "list": {
      const { surfaces } = await client.call("surfaces.list", opts.project ? { project_id: opts.project } : {});
      if (opts.json) {
        console.log(JSON.stringify(surfaces, null, 2));
        return;
      }
      for (const s of surfaces)
        console.log(
          `${s.name.padEnd(28)} ${(s.app ? "app" : "widget").padEnd(7)} v${String(s.version).padEnd(4)} ${s.project_id ?? "global"}  ${s.title}`,
        );
      if (!surfaces.length) console.log("(no artifacts yet)");
      return;
    }
    case "push": {
      const [nameArg, file] = rest;
      const name = named(nameArg);
      if (!file) throw new Error(USAGE);
      const html = fs.readFileSync(file, "utf8");
      const connect = opts.connect
        ?.split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      const title = opts.title?.trim() || /<title>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.trim() || name;
      const s = await client.call("surfaces.show", {
        name,
        title: title.slice(0, 120),
        html,
        ...(opts.app ? { app: true } : {}),
        ...(connect ? { connect } : {}),
        ...(opts.project ? { project: opts.project } : {}),
      });
      console.log(
        `${s.name}  v${s.version}  ${s.app ? "app" : "widget"}  ${s.project_id ?? "global"}  ${html.length} chars`,
      );
      return;
    }
    case "dir": {
      const dir = artifactSourceDir(apxHome(), rest[0] ?? "", opts.project);
      fs.mkdirSync(dir, { recursive: true });
      console.log(dir);
      return;
    }
    case "export": {
      const name = named(rest[0]);
      const { surfaces } = await client.call("surfaces.list", opts.project ? { project_id: opts.project } : {});
      const s = surfaces.find((x) => x.name === name && (opts.project ? x.project_id === opts.project : true));
      if (!s) throw new Error(`no artifact named ${name}${opts.project ? ` in ${opts.project}` : ""}`);
      const bundle = await client.call("surfaces.export", { surface: s.id, memory: opts.memory === true });
      const out = opts.out ?? `${name}${ARTIFACT_FILE_EXT}`;
      fs.writeFileSync(out, JSON.stringify(bundle));
      console.log(
        `${out}  ${bundle.manifest.kind}  v${bundle.manifest.version}${opts.memory ? "  with its memory" : ""}`,
      );
      return;
    }
    case "import": {
      const file = rest[0];
      if (!file) throw new Error(USAGE);
      const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as ArtifactBundle;
      const s = await client.call("surfaces.import", { bundle, ...(opts.project ? { project: opts.project } : {}) });
      console.log(`${s.name}  ${s.app ? "app" : "widget"}  ${s.project_id ?? "global"}  ${s.title}`);
      return;
    }
    default:
      throw new Error(USAGE);
  }
}
