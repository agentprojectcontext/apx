/**
 * Stub for opencode which utility.
 */
import { execSync } from "node:child_process"

export function which(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" })
    return cmd
  } catch {
    return undefined
  }
}
