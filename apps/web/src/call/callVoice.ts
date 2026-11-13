// The voice and accent a call starts with: the last pick on this device, else the ones set in Settings.
import type { CallStatus, CallVoice, VoiceLocale } from "@apx/protocol";
import { VoiceLocale as Locale } from "@apx/protocol";
import type { Language } from "../i18n/messages.ts";

const VOICE_KEY = "apx.callVoice";
const LOCALE_KEY = "apx.callLocale";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

/** The voice chosen last on this device, if any. */
function savedVoice(): CallVoice | undefined {
  const v = read(VOICE_KEY);
  return v === "male" || v === "female" ? v : undefined;
}

export function saveVoice(voice: CallVoice): void {
  write(VOICE_KEY, voice);
}

/** The accent chosen last on this device, if any. */
function savedLocale(): VoiceLocale | undefined {
  const parsed = Locale.safeParse(read(LOCALE_KEY));
  return parsed.success ? parsed.data : undefined;
}

export function saveLocale(locale: VoiceLocale): void {
  write(LOCALE_KEY, locale);
}

/** The voice a call starts with: the last pick on this device, else the one set in Settings, else by the panel's language. */
export function startingVoice(
  status: CallStatus | undefined,
  language: Language,
): { voice: CallVoice; locale: VoiceLocale } {
  return {
    voice: savedVoice() ?? status?.voice?.gender ?? "female",
    locale: savedLocale() ?? status?.voice?.locale ?? (language === "es" ? "es-AR" : "en-US"),
  };
}
