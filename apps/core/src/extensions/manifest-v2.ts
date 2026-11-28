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
import { checkSettingFile } from "./setting-file.ts";

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
  if (s.format === "https-url") {
    const invalid = () => badRequest("Enter an HTTPS address without credentials, a query or a fragment");
    if (typeof v !== "string" || !/^https:\/\//i.test(v) || /[\s\\?#]/.test(v)) throw invalid();
    if ([...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw invalid();
    // URL drops an empty userinfo marker, so inspect the authority before parsing too.
    if (
      v
        .slice(v.indexOf("//") + 2)
        .split("/")[0]
        ?.includes("@")
    )
      throw invalid();
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      throw invalid();
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash)
      throw invalid();
    return url.href;
  }
  const text = String(v).trim();
  if (s.options && !s.options.includes(text)) throw badRequest(`${s.label}: one of ${s.options.join(", ")}`);
  if (s.type === "directory" || s.type === "file") {
    const p = path.resolve(expandHome(text));
    if (s.type === "file") checkSettingFile(s, p);
    else if (!fs.statSync(p, { throwIfNoEntry: false })?.isDirectory())
      throw badRequest(`${s.label}: no folder at ${text}`);
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
      const writes = new Map<string, string | null>();
      for (const [name, v] of Object.entries(values)) {
        const s = e.manifest.settings.find((x) => x.name === name);
        if (!s) throw notFound(`setting ${name} of ${e.manifest.name}`);
        if (s.sensitive) writes.set(name, v === null || v === "" ? null : String(checked(s, v)));
        else if (v === null) delete plain[name];
        else plain[name] = checked(s, v);
      }
      for (const s of e.manifest.settings.filter((s) => s.format)) {
        const value = plain[s.name];
        if (value !== undefined) plain[s.name] = checked(s, value);
      }
      for (const s of e.manifest.settings.filter((s) => s.boundTo)) {
        if (!s.sensitive || s.type !== "string" || s.generate)
          throw badRequest("Only manually entered sensitive strings can be bound");
        const binding: Record<string, Value> = {};
        for (const name of s.boundTo ?? []) {
          const target = e.manifest.settings.find((x) => x.name === name && !x.sensitive);
          if (!target) throw badRequest("A bound credential must name plain settings");
          const value = plain[name] ?? target.default;
          if (value !== undefined) binding[name] = value;
        }
        const previous = secrets.resolve(`secret://${extSecret(e.id, s.name)}`);
        let old: { format?: string; binding?: Record<string, Value>; value?: string } = {};
        try {
          const parsed = previous ? JSON.parse(previous) : undefined;
          if (parsed && typeof parsed === "object" && typeof parsed.value === "string") old = parsed;
        } catch {
          /* Legacy credentials must be replaced. */
        }
        const changed = (s.boundTo ?? []).some((name) => old.binding?.[name] !== binding[name]);
        const next = writes.get(s.name);
        if (previous && (old.format !== "apx-bound-secret@1" || changed)) {
          if (!next || next.replace(/\s/g, "") === (old.value ?? previous).replace(/\s/g, ""))
            throw badRequest(`${s.label}: enter a different application password when changing the connection`);
        }
        if (next) {
          if ((s.boundTo ?? []).some((name) => binding[name] === undefined || binding[name] === ""))
            throw badRequest(`${s.label}: complete the connection settings first`);
          writes.set(s.name, JSON.stringify({ format: "apx-bound-secret@1", binding, value: next }));
        }
      }
      for (const [name, value] of writes) secrets.set(extSecret(e.id, name), value);
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
