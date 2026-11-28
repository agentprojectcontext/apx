// The phone's own voice (Android): listens for the super-agent's name with the app closed and carries calls through
// the owner's core. Native code in ./android; on iOS and in tests the module is absent and every call is a no-op.
import { type EventSubscription, requireOptionalNativeModule } from "expo-modules-core";

export type VoicePhase = "off" | "wake" | "connecting" | "preparing" | "listening" | "thinking" | "speaking";
export type VoiceSnapshot = {
  phase: VoicePhase;
  live: boolean;
  thread?: string | null;
  mode?: "call" | "quick";
  problem?: string | null;
};
export type VoiceAgent = { name: string; avatar?: string; eyes?: string; eyeColor?: string };

type Native = {
  configure(url: string, token: string, agent: VoiceAgent, labels: Record<string, string>): void;
  setWake(on: boolean): void;
  wake(): boolean;
  resume(): void;
  startCall(mode: "call" | "quick", agentId: string | null, thread: string | null, full: boolean): void;
  hangUp(): void;
  state(): VoiceSnapshot;
  canOverlay(): boolean;
  openOverlaySettings(): void;
  forget(): void;
  addListener(event: "onState", listener: (s: VoiceSnapshot) => void): EventSubscription;
};

const native = requireOptionalNativeModule<Native>("ApxVoice");

/** Whether this build has the native voice (Android). */
export const hasNativeVoice = native !== null;

export const nativeVoice = {
  configure: (url: string, token: string, agent: VoiceAgent, labels: Record<string, string>) =>
    native?.configure(url, token, agent, labels),
  setWake: (on: boolean) => native?.setWake(on),
  wake: () => native?.wake() ?? false,
  resume: () => native?.resume(),
  startCall: (opts: { mode?: "call" | "quick"; agentId?: string; thread?: string; full?: boolean } = {}) =>
    native?.startCall(opts.mode ?? "call", opts.agentId ?? null, opts.thread ?? null, opts.full ?? true),
  hangUp: () => native?.hangUp(),
  state: (): VoiceSnapshot => native?.state() ?? { phase: "off", live: false },
  canOverlay: () => native?.canOverlay() ?? false,
  openOverlaySettings: () => native?.openOverlaySettings(),
  forget: () => native?.forget(),
  onState: (listener: (s: VoiceSnapshot) => void): EventSubscription | undefined =>
    native?.addListener("onState", listener),
};
