import { ApxProvider, Message, VoiceNote } from "@apx/ui";

export function Default() {
  return <VoiceNote duration={10} detail="42 KB" />;
}

export function Playing() {
  return <VoiceNote duration={74} detail="Telegram" progress={0.42} />;
}

export function InMessage() {
  return (
    <div style={{ width: 460 }}>
      <Message variant="bare">
        <VoiceNote duration={18} label="Reply" detail="TTS" progress={0.1} />
      </Message>
    </div>
  );
}

export function ClassicLook() {
  return (
    <ApxProvider look="classic" mode="dark" fill style={{ padding: 16, borderRadius: 12 }}>
      <VoiceNote duration={10} label="Nota de voz" detail="42 KB" />
    </ApxProvider>
  );
}
