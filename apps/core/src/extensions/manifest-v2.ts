// Manifest 2 at runtime: an extension's settings (plain ones on its record, sensitive ones in the secret store), the
// pages, apps and companion app it carries. Files are read only from its installed copy, only the ones it declares.
// See DECISIONS.md#d-242
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ArtifactBundle, EXTENSION_ARCHIVE_MAX, type ExtensionInfo, type ExtensionSetting } from "@apx/protocol";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { expandHome, isInside } from "../paths.ts";
import { extensionSecret as extSecret } from "../secret-names.ts";
import type { Secrets } from "../secrets.ts";

type Value = string | number | boolean;
const PAGE_MAX = 1024 * 1024;

/** Its settings as the owner sees them: a plain one's value, a sensitive one only whether it is set. */
export function settingsInfo(e: Pick<ExtensionRecord, "id" | "manifest" | "settings">, secrets: Secrets) {
  return e.manifest.settings.map((s): ExtensionInfo["settings"][number] => {
    if (s.sensitive) return { ...s, set: secrets.has(`secret://${extSecret(e.id, s.name)}`) };
    const value = e.settings[s.name] ?? s.default;
    return { ...s, ...(value !== undefined ? { value } : {}), set: e.settings[s.name] !== undefined };
  });
}

/** A value checked against its setting's type; a folder or file must exist on this computer. */
function checked(s: ExtensionSetting, v: Value): Value {
  if (s.type === "number") {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw badRequest(`${s.label}: a number`);
    return n;
  }
  if (s.type === "boolean") {
    if (typeof v !== "boolean") throw badRequest(`${s.label}: yes or no`);
    return v;
  }
  const text = String(v).trim();
  if (s.options && !s.options.includes(text)) throw badRequest(`${s.label}: one of ${s.options.join(", ")}`);
  if (s.type === "directory" || s.type === "file") {
    const p = path.resolve(expandHome(text));
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st || (s.type === "directory" ? !st.isDirectory() : !st.isFile()))
      throw badRequest(`${s.label}: no ${s.type === "directory" ? "folder" : "file"} at ${text}`);
    return p;
  }
  return text;
}

export function createManifestV2(deps: { store: Store; secrets: Secrets }) {
  const { store, secrets } = deps;
  /** A file it declares, inside its installed copy. */
  const own = (e: ExtensionRecord, rel: string, max: number): Buffer => {
    const f = path.resolve(e.dir, rel);
    if (!isInside(e.dir, f) || !fs.existsSync(f)) throw notFound(`${rel} in ${e.manifest.name}`);
    if (fs.statSync(f).size > max) throw badRequest(`${rel} is too big to open here`);
    return fs.readFileSync(f);
  };
  return {
    /** Sets some values (null clears one); a sensitive one goes to the secret store, never on the record. */
    set(e: ExtensionRecord, values: Record<string, Value | null>): void {
      const plain = { ...e.settings };
      for (const [name, v] of Object.entries(values)) {
        const s = e.manifest.settings.find((x) => x.name === name);
        if (!s) throw notFound(`setting ${name} of ${e.manifest.name}`);
        if (s.sensitive) secrets.set(extSecret(e.id, name), v === null || v === "" ? null : String(checked(s, v)));
        else if (v === null) delete plain[name];
        else plain[name] = checked(s, v);
      }
      store.extensions.setSettings(e.id, plain);
    },
    /** On install: a random value for each sensitive setting it asks APX to generate, unless one is set already. */
    generate(e: ExtensionRecord): void {
      for (const s of e.manifest.settings)
        if (s.generate === "random" && !secrets.has(`secret://${extSecret(e.id, s.name)}`))
          secrets.set(extSecret(e.id, s.name), randomBytes(32).toString("hex"));
    },
    page(e: ExtensionRecord, id: string): { title: string; html: string } {
      const p = e.manifest.pages.find((x) => x.id === id);
      if (!p) throw notFound(`page ${id} of ${e.manifest.name}`);
      return { title: p.title, html: own(e, p.entry, PAGE_MAX).toString("utf8") };
    },
    companionFile(e: ExtensionRecord): { name: string; data: string } {
      const f = e.manifest.companion?.file;
      if (!f) throw notFound(`a companion app in ${e.manifest.name}`);
      return { name: path.basename(f), data: own(e, f, EXTENSION_ARCHIVE_MAX).toString("base64") };
    },
    appBundle(e: ExtensionRecord, file: string): ArtifactBundle {
      if (!e.manifest.apps.some((a) => a.file === file)) throw notFound(`${file} in ${e.manifest.name}`);
      let raw: unknown;
      try {
        raw = JSON.parse(own(e, file, EXTENSION_ARCHIVE_MAX).toString("utf8"));
      } catch {
        throw badRequest(`${file} is not an artifact`);
      }
      const p = ArtifactBundle.safeParse(raw);
      if (!p.success) throw badRequest(`${file} is not an artifact`);
      return p.data;
    },
  };
}

