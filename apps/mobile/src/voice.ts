// The phone's voice (modules/apx-voice): told where the core is and who answers, and listening again when the app
// opens if the owner turned waking by voice on. The words its screens show come from here, in the phone's language.
import { useEffect } from "react";
import { Image, PermissionsAndroid, Platform } from "react-native";
import { nativeVoice } from "../modules/apx-voice";
import type { Creds } from "./creds";
import type { Agent } from "./hooks/useWorkspace";
import { t } from "./i18n";
import { agentBlob } from "./ui/kit";

/** The microphone (and, from Android 13, notices: the voice says it is listening in one). */
export async function microphone(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const asks = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Number(Platform.Version) >= 33) asks.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const got = await PermissionsAndroid.requestMultiple(asks);
  return got[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

/** Calls an agent from its chat: the phone-call screen, carried by the phone's own voice. */
export async function callAgent(agentId: string, thread?: string) {
  if (!(await microphone())) return;
  nativeVoice.startCall({ mode: "call", agentId, ...(thread ? { thread } : {}), full: true });
}

/** The super-agent: who answers when the phone hears its name. */
export const boss = (agents: readonly Agent[]) => agents.find((a) => a.kind === "secretary");

function labels(name: string): Record<string, string> {
  return {
    wakeTitle: t("voiceNotifTitle", { name: "{name}" }),
    wakeText: t("voiceNotifText"),
    inCallTitle: t("voiceNotifCall", { name: "{name}" }),
    inCallText: t("voiceNotifCallText"),
    stopWake: t("voiceStop"),
    hangUp: t("voiceHangUp"),
    mute: t("voiceMute"),
    minimize: t("voiceMinimize"),
    channel: t("voiceChannel"),
    channelCall: t("voiceChannelCall"),
    connecting: t("voiceConnecting"),
    preparing: t("voicePreparing"),
    listening: t("voiceListening"),
    thinking: t("voiceThinking"),
    speaking: t("voiceSpeaking"),
    failed: t("voiceFailed"),
    name,
  };
}

export function useNativeVoice(creds: Creds, agents: readonly Agent[]) {
  const agent = boss(agents);
  const name = agent?.name ?? "";
  const look = agent ? agentBlob(agent.name, agent.blob, agent.id) : undefined;
  const avatar = look?.source ? (Image.resolveAssetSource(look.source)?.uri ?? "") : "";
  const eyes = JSON.stringify(look?.eyes ?? []);
  const eyeColor = look?.eyeColor ?? "";
  useEffect(() => {
    if (!name) return;
    nativeVoice.configure(
      creds.url,
      creds.token,
      { name, avatar, eyes, ...(eyeColor ? { eyeColor } : {}) },
      labels(name),
    );
    nativeVoice.resume();
  }, [creds.url, creds.token, name, avatar, eyes, eyeColor]);
}
