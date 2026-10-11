// What the system's notification permission means for the app: on, not yet on (the owner can still be asked), or
// refused for good (only the system settings can turn it on). Kept apart from expo so it is tested in Node.

export type PermissionState = "granted" | "off" | "denied";

export function permissionState(result: { granted: boolean; canAskAgain: boolean; provisional?: boolean }) {
  if (result.granted || result.provisional) return "granted" as const;
  return result.canAskAgain ? ("off" as const) : ("denied" as const);
}

/** The system prompt is spent only when the owner taps to turn notifications on, never when a screen opens. */
export function shouldAsk(state: PermissionState, ownerTapped: boolean): boolean {
  return state === "off" && ownerTapped;
}
