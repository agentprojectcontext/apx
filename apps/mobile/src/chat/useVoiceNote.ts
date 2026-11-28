import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { t } from "../i18n";
import type { ApxClient } from "../protocol";
import type { Attachment } from "./useAttachments";

/**
 * A voice note as the panel does it: record, attach the audio, and put its transcript in the field to read before
 * sending. When nothing can transcribe it, the audio still goes attached.
 */
export function useVoiceNote({
  client,
  threadId,
  upload,
  onWords,
}: {
  client: ApxClient;
  /** Undefined for a new chat not made yet: the audio goes with its first message. */
  threadId: string | undefined;
  upload: (uri: string, name: string, mime: string) => Promise<Attachment | undefined>;
  /** The transcript, for the composer to put in its field. */
  onWords?: (words: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const status = useAudioRecorderState(recorder, 250);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  /** False when the microphone was refused: nothing records. */
  const start = useCallback(async (): Promise<boolean> => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("voiceNote"), t("micDenied"));
      return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState("recording");
    return true;
  }, [recorder]);
  /** The uploaded audio and what was heard in it; nothing when the recording or its upload failed. */
  const stop = useCallback(async (): Promise<{ audio: string; words?: string } | undefined> => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const uri = recorder.uri;
    if (!uri) {
      setState("idle");
      return undefined;
    }
    setState("transcribing");
    try {
      const audio = await upload(uri, `${t("voiceNote")}.m4a`, "audio/mp4");
      if (!audio?.id) return undefined;
      const heard = await client
        .call("media.transcribe", { media_id: audio.id, ...(threadId ? { thread: threadId } : {}) })
        .catch(() => undefined);
      const words = heard?.text.trim();
      if (words) onWords?.(words);
      return { audio: audio.id, ...(words ? { words } : {}) };
    } finally {
      setState("idle");
    }
  }, [recorder, upload, client, threadId, onWords]);
  /** Drops the recording: nothing is uploaded. */
  const cancel = useCallback(async () => {
    await recorder.stop().catch(() => undefined);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setState("idle");
  }, [recorder]);
  return { state, seconds: Math.floor((status.durationMillis ?? 0) / 1000), start, stop, cancel };
}
