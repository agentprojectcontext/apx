import type { ExtensionPower } from "@apx/protocol";
import { type MessageKey, useT } from "../i18n/index.ts";

// One thing an extension may do, in the owner's words: what an update adds or drops.

export function usePowerText(): (p: ExtensionPower) => string {
  const t = useT();
  return (p) => t(`extPower.${p.kind}` as MessageKey, { name: p.kind === "secret" ? (p.detail ?? p.name) : p.name });
}
