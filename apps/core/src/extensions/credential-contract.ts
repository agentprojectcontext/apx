import type { ExtensionManifest } from "@apx/protocol";
import { extensionSecret } from "../secret-names.ts";
import type { Secrets } from "../secrets.ts";

function contracts(manifest: ExtensionManifest): Map<string, string> {
  const result = new Map<string, string>();
  for (const secret of manifest.secrets) result.set(secret.name, JSON.stringify({ kind: "secret" }));
  for (const setting of manifest.settings.filter((s) => s.sensitive)) {
    const binding = [...(setting.boundTo ?? [])].sort().map((name) => {
      const target = manifest.settings.find((s) => s.name === name);
      return { name, type: target?.type, format: target?.format };
    });
    result.set(
      setting.name,
      JSON.stringify({ kind: "setting", type: setting.type, generate: setting.generate, binding }),
    );
  }
  return result;
}

/** Credentials cannot cross a changed declaration, including when returning to an older package. */
export function clearChangedCredentials(
  id: string,
  before: ExtensionManifest,
  after: ExtensionManifest,
  secrets: Secrets,
) {
  // Bound credentials opt into reconnection; unrelated packages retain their existing update lifecycle.
  if (![...before.settings, ...after.settings].some((s) => s.boundTo)) return;
  const old = contracts(before);
  const next = contracts(after);
  for (const name of new Set([...old.keys(), ...next.keys()])) {
    if (old.get(name) !== next.get(name)) secrets.set(extensionSecret(id, name), null);
  }
}
