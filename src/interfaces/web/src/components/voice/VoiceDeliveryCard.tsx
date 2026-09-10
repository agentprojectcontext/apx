import { Switch } from "../ui";
import { t } from "../../i18n";

// How a spoken reply is delivered, as opposed to which engine speaks it.
//
// Two switches that look alike and are not. "Send part as audio" decides
// whether replies are spoken at all; "streaming" decides how the audio gets
// from the engine to the speakers, and only the desktop can use it. Keeping
// them in one card is what makes the difference visible — they were both
// config keys nobody could reach without the CLI.
export function VoiceDeliveryCard({
  voiceReplies,
  stream,
  streamSupported,
  onPatch,
  busy,
}: {
  voiceReplies: boolean;
  stream: boolean;
  streamSupported: boolean;
  onPatch: (set: Record<string, unknown>) => void | Promise<void>;
  busy?: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t("voice_ui.replies_label")}</span>
          <span className="block text-xs text-muted-foreground">{t("voice_ui.replies_desc")}</span>
        </span>
        <Switch
          checked={voiceReplies}
          disabled={busy}
          onChange={(v: boolean) => onPatch({ "voice.voice_replies": v })}
        />
      </label>

      <label className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t("voice_ui.stream_label")}</span>
          <span className="block text-xs text-muted-foreground">
            {streamSupported ? t("voice_ui.stream_desc") : t("voice_ui.stream_unsupported")}
          </span>
        </span>
        <Switch
          checked={stream}
          disabled={busy || !streamSupported}
          onChange={(v: boolean) => onPatch({ "voice.tts.stream": v })}
        />
      </label>
    </div>
  );
}
