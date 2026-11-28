import type { ServiceInfo } from "@apx/protocol";
import { Skeleton } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadVoice, useVoice } from "../data/voice.ts";
import { usePack, useT } from "../i18n/index.ts";
import { CallsSettings } from "./CallsSection.tsx";
import { LocalTranscription } from "./LocalTranscription.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";
import { ServicesSection } from "./ServicesSection.tsx";

/**
 * Settings › Voice and calls: how agents speak (voices in order, APX's own first), how they hear (transcription in
 * order) and calls. `calls` opens it at the calls part.
 */
export function VoiceSection({ focus }: { focus?: "calls" }) {
  return usePack("voice") ? <Voices focus={focus} /> : <Skeleton height={240} shape="block" />;
}

function Voices({ focus }: { focus?: "calls" | undefined }) {
  const t = useT();
  const voice = useVoice();
  const [speech, setSpeech] = useState<ServiceInfo[]>();
  const [hearing, setHearing] = useState<ServiceInfo[]>();
  const calls = useRef<HTMLHeadingElement>(null);
  const serviceList = useRef<HTMLHeadingElement>(null);
  const manage = () => {
    serviceList.current?.scrollIntoView({ block: "start" });
    serviceList.current?.focus({ preventScroll: true });
  };
  const [hearKey, setHearKey] = useState(0);
  const refreshHear = useCallback(() => setHearKey((k) => k + 1), []);
  useEffect(() => {
    void loadVoice();
  }, []);
  useEffect(() => {
    if (focus === "calls") calls.current?.scrollIntoView({ block: "start" });
  }, [focus]);
  return (
    <>
      <SectionHead title={t("config.voices")} lead={t("voice.lead")} />
      <SubHead ref={serviceList}>{t("voice.speak")}</SubHead>
      <p className="config__lead">{t("voice.speakLead")}</p>
      <ServicesSection kind="speech" bare onChange={setSpeech} />
      <SubHead>{t("voice.hear")}</SubHead>
      <p className="config__lead">{t("voice.hearLead")}</p>
      {/* Transcription on this machine is offered only where APX's own voice can't hear for the owner. */}
      {(!voice || voice.tier === "none" || !voice.enabled) && <LocalTranscription onInstalled={refreshHear} />}
      <ServicesSection key={hearKey} kind="transcription" embedded onChange={setHearing} />
      <SubHead ref={calls}>{t("config.calls")}</SubHead>
      <p className="config__lead">{t("calls.lead")}</p>
      <CallsSettings speech={speech} hearing={hearing} onManage={manage} />
    </>
  );
}
