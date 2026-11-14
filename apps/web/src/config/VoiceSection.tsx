import { Skeleton } from "@apx/ui";
import { useEffect } from "react";
import { loadVoice } from "../data/voice.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";
import { ServicesSection } from "./ServicesSection.tsx";

/** Settings › Voices: one ordered list of voices, APX's own first, then transcription the same way. */
export function VoiceSection() {
  return usePack("voice") ? <Voices /> : <Skeleton height={240} shape="block" />;
}

function Voices() {
  const t = useT();
  useEffect(() => {
    void loadVoice();
  }, []);
  return (
    <>
      <SectionHead title={t("config.voices")} lead={t("voice.lead")} />
      <ServicesSection kind="speech" bare />
    </>
  );
}
