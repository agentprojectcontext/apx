import { conflict } from "../errors.ts";

export function browserEpochBackend(binding: string): string | undefined {
  try {
    const value: unknown = JSON.parse(binding);
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string"
      ? value[0]
      : undefined;
  } catch {
    return undefined;
  }
}

/** A node reconnect must not resurrect consent for tabs that kept their local identifiers. */
export function bindBrowserEpoch(backend: string, epoch: string): string {
  return JSON.stringify([backend, epoch]);
}

export function unbindBrowserEpoch(backend: string, binding: string): string {
  let value: unknown;
  try {
    value = JSON.parse(binding);
  } catch {
    throw conflict("Browser connection changed; inspect and approve again");
  }
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== backend || typeof value[1] !== "string")
    throw conflict("Browser connection changed; inspect and approve again");
  return value[1];
}
