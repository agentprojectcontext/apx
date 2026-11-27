import type { ExtensionSetting } from "@apx/protocol";

/** Translate copy only: names, values and choices remain the extension's contract. */
export function settingText(
  s: Pick<ExtensionSetting, "label" | "locales"> & { description?: string | undefined },
  language: string,
): { label: string; description?: string } {
  const copy = language === "es" ? s.locales?.es : undefined;
  return { label: copy?.label ?? s.label, description: copy?.description ?? s.description };
}
