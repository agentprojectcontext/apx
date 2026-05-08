import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const IDENTITY_PATH = path.join(os.homedir(), ".apx", "identity.json");

export function readIdentity() {
  try {
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeIdentity(fields) {
  const existing = readIdentity() || {};
  const now = new Date().toISOString();
  const updated = { ...existing, ...fields, updated: now };
  if (!updated.created) updated.created = now;
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}
