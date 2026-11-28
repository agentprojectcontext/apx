import { callScene, useCalls } from "../data/calls.ts";
import { LiveCallBar } from "./LiveCallBar.tsx";
import { WakeListener } from "./WakeListener.tsx";

/** Beside the call card: a call going on somewhere else, or (the shell mounts it only when allowed) the wake listener. */
export function CallCompanion() {
  return useCalls(callScene) === "elsewhere" ? <LiveCallBar /> : <WakeListener />;
}
